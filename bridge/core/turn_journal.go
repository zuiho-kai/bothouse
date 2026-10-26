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
	TurnTriggerWorkspace = "workspace" // a workspace handoff wake-up (TimerJob.Handoff)
)

// Entry kinds (TurnJournalEntry.Kind). Only interactive turns are written now;
// "bg" (background task records) is reserved for K10.
const (
	TurnKindTurn = "turn"
	TurnKindBG   = "bg"
)

const turnJournalMaxUserMessage = 2000 // runes

// TurnJournalEntry is the on-disk record of one running turn.
type TurnJournalEntry struct {
	TurnID          string    `json:"turn_id"`
	Kind            string    `json:"kind,omitempty"` // TurnKind*; "" reads as TurnKindTurn
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
	// Supersedes (not stored) is the TurnID of an entry this one replaces: a
	// prompt-too-long re-run on a fresh session takes over the failed turn's
	// entry, so the message is not left recorded twice.
	Supersedes string `json:"-"`
	// NoProgressCount counts consecutive resumes that made no progress; K4
	// stops resuming when it reaches its limit.
	NoProgressCount int       `json:"no_progress_count,omitempty"`
	Interrupted     bool      `json:"interrupted,omitempty"`
	InterruptedAt   time.Time `json:"interrupted_at,omitempty"`
}

// TurnJournal stores the entries of one project, keyed by turn id. Entries
// loaded from disk (left by an earlier process) are never replaced by a new
// turn on the same interactive key; only a Begin whose ResumedFrom names one
// removes it. active maps an interactive key to the turn this process is
// running on it (the session lock allows one), so a queued message chained
// into that turn can update it.
type TurnJournal struct {
	mu      sync.Mutex
	path    string
	entries map[string]*TurnJournalEntry // by TurnID
	active  map[string]string            // interactive key -> TurnID (this process)
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
	j := &TurnJournal{path: path, entries: map[string]*TurnJournalEntry{}, active: map[string]string{}}
	data, err := os.ReadFile(path)
	if err == nil && len(data) > 0 {
		var list []*TurnJournalEntry
		if err := json.Unmarshal(data, &list); err != nil {
			slog.Error("turn journal: failed to load", "path", path, "error", err)
		} else {
			for _, en := range list {
				if en != nil && en.TurnID != "" {
					j.entries[en.TurnID] = en
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

// Begin records a turn as started and makes it the active turn of its
// interactive key. It never replaces another entry; when ResumedFrom is set,
// the entry it continues is removed, and likewise the one named by
// Supersedes. TurnID, Kind and StartedAt are filled in
// when empty.
func (j *TurnJournal) Begin(en TurnJournalEntry) (TurnJournalEntry, error) {
	if en.TurnID == "" {
		en.TurnID = newTurnID()
	}
	if en.Kind == "" {
		en.Kind = TurnKindTurn
	}
	if en.StartedAt.IsZero() {
		en.StartedAt = time.Now()
	}
	en.LastUserMessage = truncateRunes(en.LastUserMessage, turnJournalMaxUserMessage)
	j.mu.Lock()
	defer j.mu.Unlock()
	if en.ResumedFrom != "" {
		delete(j.entries, en.ResumedFrom)
	}
	if en.Supersedes != "" {
		if old, ok := j.entries[en.Supersedes]; ok {
			j.clearActiveLocked(old.InteractiveKey, en.Supersedes)
			delete(j.entries, en.Supersedes)
		}
	}
	en.Supersedes = ""
	cp := en
	j.entries[en.TurnID] = &cp
	if en.Kind == TurnKindTurn && en.InteractiveKey != "" {
		j.active[en.InteractiveKey] = en.TurnID
	}
	return en, j.saveLocked()
}

// Active returns the turn id this process is running on key ("" if none).
func (j *TurnJournal) Active(key string) string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.active[key]
}

// Update applies fn to the entry turnID and saves; false when there is none.
// fn must not change TurnID.
func (j *TurnJournal) Update(turnID string, fn func(*TurnJournalEntry)) (bool, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	en, ok := j.entries[turnID]
	if !ok {
		return false, nil
	}
	fn(en)
	en.TurnID = turnID
	en.LastUserMessage = truncateRunes(en.LastUserMessage, turnJournalMaxUserMessage)
	return true, j.saveLocked()
}

// Mark flags the entry turnID as interrupted (kept on disk for resume); the
// turn is no longer active.
func (j *TurnJournal) Mark(turnID string) (bool, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	en, ok := j.entries[turnID]
	if !ok {
		return false, nil
	}
	en.Interrupted = true
	en.InterruptedAt = time.Now()
	j.clearActiveLocked(en.InteractiveKey, turnID)
	return true, j.saveLocked()
}

// Delete removes the entry turnID (no-op when it is gone).
func (j *TurnJournal) Delete(turnID string) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	en, ok := j.entries[turnID]
	if !ok {
		return nil
	}
	delete(j.entries, turnID)
	j.clearActiveLocked(en.InteractiveKey, turnID)
	return j.saveLocked()
}

func (j *TurnJournal) clearActiveLocked(key, turnID string) {
	if j.active[key] == turnID {
		delete(j.active, key)
	}
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

func queuedTurnTrigger(q *queuedMessage) string {
	return turnTriggerOf(&Message{turnTrigger: q.turnTrigger, UserID: q.userID, scheduledFrom: q.scheduledFrom})
}

// journalTurnBegin writes the entry for a turn whose user message was just
// saved, before the agent is started (pid/session id follow in
// journalTurnAgent). Returns the turn id ("" when the journal is off or the
// write failed).
func (e *Engine) journalTurnBegin(msg *Message, interactiveKey, workspaceDir string, session *Session) string {
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
		Supersedes:      msg.journalSupersedes,
	}
	if session != nil {
		en.AgentSessionID = session.GetAgentSessionID()
	}
	out, err := j.Begin(en)
	if err != nil {
		slog.Warn("turn journal: begin failed", "key", interactiveKey, "error", err)
		return ""
	}
	return out.TurnID
}

func journalAgentFields(en *TurnJournalEntry, as AgentSession) {
	if as == nil {
		return
	}
	if id := as.CurrentSessionID(); id != "" {
		en.AgentSessionID = id
	}
	if pi, ok := as.(AgentProcessInfo); ok {
		en.AgentPID = pi.ProcessID()
		en.AgentPGID = pi.ProcessGroupID()
	}
}

// journalTurnAgent records the started agent's session id and process.
func (e *Engine) journalTurnAgent(turnID string, as AgentSession) {
	j := e.turnJournalStore()
	if j == nil || turnID == "" || as == nil {
		return
	}
	if _, err := j.Update(turnID, func(en *TurnJournalEntry) { journalAgentFields(en, as) }); err != nil {
		slog.Warn("turn journal: update failed", "turn", turnID, "error", err)
	}
}

// journalQueuedTurn records a queued message about to be sent. When this
// process already runs a turn on interactiveKey (the queued message is chained
// into it), that entry is rewritten to the queued message and owned=false.
// Otherwise (a queue drained outside processInteractiveMessageWith) a new
// entry is begun and owned=true: the caller ends it with journalTurnEnd.
func (e *Engine) journalQueuedTurn(q *queuedMessage, interactiveKey, workspaceDir string, as AgentSession) (turnID string, owned bool) {
	j := e.turnJournalStore()
	if j == nil || q == nil {
		return "", false
	}
	now := time.Now()
	if id := j.Active(interactiveKey); id != "" {
		ok, err := j.Update(id, func(en *TurnJournalEntry) {
			en.LastUserMessage = q.content
			en.StartedAt = now
			en.Trigger = queuedTurnTrigger(q)
			en.SessionKey = q.msgSessionKey
			en.Platform = q.msgPlatform
			journalAgentFields(en, as)
		})
		if err != nil {
			slog.Warn("turn journal: update failed", "turn", id, "error", err)
		}
		if ok {
			return id, false
		}
	}
	en := TurnJournalEntry{
		Project:         e.name,
		SessionKey:      q.msgSessionKey,
		InteractiveKey:  interactiveKey,
		WorkspaceDir:    workspaceDir,
		Platform:        q.msgPlatform,
		Trigger:         queuedTurnTrigger(q),
		LastUserMessage: q.content,
		StartedAt:       now,
	}
	journalAgentFields(&en, as)
	out, err := j.Begin(en)
	if err != nil {
		slog.Warn("turn journal: begin failed", "key", interactiveKey, "error", err)
		return "", false
	}
	return out.TurnID, true
}

// journalTurnEnd removes the entry of a turn that ended, or marks it
// interrupted when the engine is stopping (the shutdown ended it).
func (e *Engine) journalTurnEnd(turnID string) {
	if turnID == "" {
		return
	}
	j := e.turnJournalStore()
	if j == nil {
		return
	}
	var err error
	if e.isStoppingForJournal() {
		_, err = j.Mark(turnID)
	} else {
		err = j.Delete(turnID)
	}
	if err != nil {
		slog.Warn("turn journal: end failed", "turn", turnID, "error", err)
	}
}

func (e *Engine) isStoppingForJournal() bool {
	e.platformLifecycleMu.Lock()
	stopping := e.stopping
	e.platformLifecycleMu.Unlock()
	return stopping || (e.ctx != nil && e.ctx.Err() != nil)
}
