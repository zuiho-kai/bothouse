package core

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Turn journal (#618 K1): one entry per running interactive turn, written to
// disk when the turn starts and removed when it ends normally. A bridge killed
// mid-turn (launchd kickstart -k, SIGKILL) leaves the entry behind, so the next
// start can see which turns were cut off and resume them (K4, turn_resume.go).
// A turn that ends while the engine is stopping is kept and marked interrupted
// instead of deleted: its end was caused by the shutdown, not by finishing.

// Turn trigger kinds recorded in TurnJournalEntry.Trigger.
const (
	TurnTriggerUser      = "user"
	TurnTriggerTimer     = "timer"
	TurnTriggerCron      = "cron"
	TurnTriggerHeartbeat = "heartbeat"
	TurnTriggerRelay     = "relay"
	TurnTriggerWorkspace = "workspace" // a workspace handoff wake-up (TimerJob.Handoff)
)

const turnJournalMaxUserMessage = 2000 // runes

// TurnJournalEntry is the on-disk record of one running turn.
type TurnJournalEntry struct {
	TurnID          string    `json:"turn_id"`
	Project         string    `json:"project"`
	SessionKey      string    `json:"session_key"`
	InteractiveKey  string    `json:"interactive_key"`
	WorkspaceDir    string    `json:"workspace_dir,omitempty"`
	Platform        string    `json:"platform,omitempty"`
	Trigger         string    `json:"trigger"`
	AgentSessionID  string    `json:"agent_session_id,omitempty"`
	AgentPID        int       `json:"agent_pid,omitempty"`
	AgentPGID       int       `json:"agent_pgid,omitempty"`
	LastUserMessage string    `json:"last_user_message,omitempty"`
	StartedAt       time.Time `json:"started_at"`
	// ResumedFrom is the TurnID of the interrupted turn this one continues
	// (empty for an original turn); following it gives the resume chain.
	ResumedFrom string `json:"resumed_from,omitempty"`
	// NoProgressCount counts consecutive resumes that made no progress; K4
	// stops resuming when it reaches its limit.
	NoProgressCount int       `json:"no_progress_count,omitempty"`
	Interrupted     bool      `json:"interrupted,omitempty"`
	InterruptedAt   time.Time `json:"interrupted_at,omitempty"`
}

// TurnJournal stores the entries of one project, keyed by interactive key
// (one running turn per interactive key: the session lock is held for it).
type TurnJournal struct {
	mu      sync.Mutex
	path    string
	entries map[string]*TurnJournalEntry
}

// TurnJournalPath is where a project's journal lives under the data dir.
func TurnJournalPath(dataDir, project string) string {
	return filepath.Join(dataDir, "turn-journal", sanitizeJournalName(project)+".json")
}

func sanitizeJournalName(s string) string {
	if s == "" {
		return "default"
	}
	return strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == 0 {
			return '_'
		}
		return r
	}, s)
}

// OpenTurnJournal loads (or starts) the journal at path. A missing or broken
// file yields an empty journal; a broken file is logged, not fatal.
func OpenTurnJournal(path string) (*TurnJournal, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	j := &TurnJournal{path: path, entries: map[string]*TurnJournalEntry{}}
	data, err := os.ReadFile(path)
	if err == nil && len(data) > 0 {
		var list []*TurnJournalEntry
		if err := json.Unmarshal(data, &list); err != nil {
			slog.Error("turn journal: failed to load", "path", path, "error", err)
		} else {
			for _, en := range list {
				if en != nil && en.InteractiveKey != "" {
					j.entries[en.InteractiveKey] = en
				}
			}
		}
	}
	return j, nil
}

func (j *TurnJournal) saveLocked() error {
	list := make([]*TurnJournalEntry, 0, len(j.entries))
	for _, en := range j.entries {
		list = append(list, en)
	}
	sort.Slice(list, func(a, b int) bool { return list[a].StartedAt.Before(list[b].StartedAt) })
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	// 0600: last_user_message may hold private channel text.
	return AtomicWriteFile(j.path, data, 0o600)
}

// Begin records a turn as started. It replaces any entry on the same
// interactive key. TurnID and StartedAt are filled in when empty.
func (j *TurnJournal) Begin(en TurnJournalEntry) (TurnJournalEntry, error) {
	if en.TurnID == "" {
		en.TurnID = newTurnID()
	}
	if en.StartedAt.IsZero() {
		en.StartedAt = time.Now()
	}
	en.LastUserMessage = truncateRunes(en.LastUserMessage, turnJournalMaxUserMessage)
	j.mu.Lock()
	defer j.mu.Unlock()
	cp := en
	j.entries[en.InteractiveKey] = &cp
	return en, j.saveLocked()
}

// Update applies fn to the entry on key and saves; false when there is none.
func (j *TurnJournal) Update(key string, fn func(*TurnJournalEntry)) (bool, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	en, ok := j.entries[key]
	if !ok {
		return false, nil
	}
	fn(en)
	return true, j.saveLocked()
}

// Mark flags the entry on key as interrupted (kept on disk for resume).
func (j *TurnJournal) Mark(key string) (bool, error) {
	return j.Update(key, func(en *TurnJournalEntry) {
		en.Interrupted = true
		en.InterruptedAt = time.Now()
	})
}

// Delete removes the entry on key. turnID, when non-empty, must match, so a
// late end of an old turn does not delete the entry of a newer one.
func (j *TurnJournal) Delete(key, turnID string) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	en, ok := j.entries[key]
	if !ok || (turnID != "" && en.TurnID != turnID) {
		return nil
	}
	delete(j.entries, key)
	return j.saveLocked()
}

// List returns copies of all entries, oldest first.
func (j *TurnJournal) List() []TurnJournalEntry {
	j.mu.Lock()
	defer j.mu.Unlock()
	out := make([]TurnJournalEntry, 0, len(j.entries))
	for _, en := range j.entries {
		out = append(out, *en)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].StartedAt.Before(out[b].StartedAt) })
	return out
}

func newTurnID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return time.Now().UTC().Format("20060102T150405") + "-" + hex.EncodeToString(b[:])
}

// AgentProcessInfo is implemented by agent sessions that run a local process,
// so the journal can name the process (group) a cut-off turn left running.
type AgentProcessInfo interface {
	ProcessID() int
	ProcessGroupID() int
}

// ---- engine wiring ----

// turnJournalStore returns the project's journal, opened on first use; nil
// when the engine has no data dir (tests, ephemeral engines).
func (e *Engine) turnJournalStore() *TurnJournal {
	e.turnJournalOnce.Do(func() {
		if e.dataDir == "" {
			return
		}
		j, err := OpenTurnJournal(TurnJournalPath(e.dataDir, e.name))
		if err != nil {
			slog.Warn("turn journal: open failed", "project", e.name, "error", err)
			return
		}
		e.turnJournal = j
	})
	return e.turnJournal
}

// TurnJournal exposes the project's journal (K4 resume reads it).
func (e *Engine) TurnJournal() *TurnJournal { return e.turnJournalStore() }

func timerTurnTrigger(job *TimerJob) string {
	if job != nil && job.Handoff {
		return TurnTriggerWorkspace
	}
	return TurnTriggerTimer
}

func turnTriggerOf(msg *Message) string {
	if msg.turnTrigger != "" {
		return msg.turnTrigger
	}
	if msg.UserID == "heartbeat" {
		return TurnTriggerHeartbeat
	}
	if msg.scheduledFrom != nil {
		return TurnTriggerTimer
	}
	return TurnTriggerUser
}

// journalTurnBegin writes the entry for a turn about to be sent. Returns the
// turn id ("" when the journal is off or the write failed).
func (e *Engine) journalTurnBegin(msg *Message, interactiveKey, workspaceDir string, session *Session, as AgentSession) string {
	j := e.turnJournalStore()
	if j == nil || msg == nil || msg.inputTurn != nil {
		return ""
	}
	en := TurnJournalEntry{
		Project:         e.name,
		SessionKey:      msg.SessionKey,
		InteractiveKey:  interactiveKey,
		WorkspaceDir:    workspaceDir,
		Platform:        msg.Platform,
		Trigger:         turnTriggerOf(msg),
		LastUserMessage: msg.Content,
		ResumedFrom:     msg.resumedFrom,
	}
	if session != nil {
		en.AgentSessionID = session.GetAgentSessionID()
	}
	if as != nil {
		if id := as.CurrentSessionID(); id != "" {
			en.AgentSessionID = id
		}
		if pi, ok := as.(AgentProcessInfo); ok {
			en.AgentPID = pi.ProcessID()
			en.AgentPGID = pi.ProcessGroupID()
		}
	}
	out, err := j.Begin(en)
	if err != nil {
		slog.Warn("turn journal: begin failed", "key", interactiveKey, "error", err)
		return ""
	}
	return out.TurnID
}

// journalTurnEnd removes the entry of a turn that ended, or marks it
// interrupted when the engine is stopping (the shutdown ended it).
func (e *Engine) journalTurnEnd(interactiveKey, turnID string) {
	if turnID == "" {
		return
	}
	j := e.turnJournalStore()
	if j == nil {
		return
	}
	var err error
	if e.isStoppingForJournal() {
		_, err = j.Mark(interactiveKey)
	} else {
		err = j.Delete(interactiveKey, turnID)
	}
	if err != nil {
		slog.Warn("turn journal: end failed", "key", interactiveKey, "error", err)
	}
}

func (e *Engine) isStoppingForJournal() bool {
	e.platformLifecycleMu.Lock()
	stopping := e.stopping
	e.platformLifecycleMu.Unlock()
	return stopping || (e.ctx != nil && e.ctx.Err() != nil)
}
