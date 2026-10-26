package core

// Lead handoff (#274): the bridge, not the outgoing lead, keeps the record the
// next lead needs. Task cards, workspace handoffs and forwarded [ask]s are
// already written at their key events; this file turns those durable records
// into one switch record, injects it into the new lead's next turn, and keeps
// feeding results that arrive after the switch. It deliberately does not migrate
// a CLI's internal session, hidden state or running tool processes.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	leadHandoffFileName = "lead-handoff.json"
	leadHandoffVersion  = 1
	// Source: docs/PUBLIC_PROGRESS.md, the pinned task board shows at most 12
	// items; the handoff uses the same public picture and leaves the rest in
	// the task cards.
	leadHandoffMaxTasks = 12
	// Source: #274 asks for enough evidence to locate each task's basis, not a
	// copy of the full journal; the latest 3 key facts do that and the source
	// file keeps the rest.
	leadHandoffEventsPerTask = 3
	// Source: docs/PUBLIC_PROGRESS.md, a card is a continuation candidate for
	// 24 hours after its last update; older closed cards are history, not work.
	leadHandoffRecent = 24 * time.Hour
	// Source: PublicProgressRequest.Validate caps one public summary at 500
	// characters; an [ask] body uses the same public budget.
	leadHandoffQuestionRunes = 500
	// Source: #274 requires repeated switches to stay traceable while the live
	// record stays small; keep the latest 20 switch records.
	leadHandoffHistoryMax = 20
)

const (
	// LeadHandoffPending: the switch is recorded and waiting for the new lead's
	// next turn to confirm it.
	LeadHandoffPending = "pending"
	// LeadHandoffActive: the new lead's turn was assembled from the record.
	LeadHandoffActive = "active"
	// LeadHandoffFailed: the target could not be selected (not connected,
	// stopped, or the selection could not be written); task records stay.
	LeadHandoffFailed = "failed"
	// LeadHandoffSuperseded: another switch happened before this one was used.
	LeadHandoffSuperseded = "superseded"
)

// leadHandoffMu serializes read-modify-write of the shared switch file. The
// bridge's supported deployment has one writer process (PUBLIC_PROGRESS.md);
// engines in that process share this mutex.
var leadHandoffMu sync.Mutex

// LeadHandoff is one switch record. It is persisted before the new lead runs.
type LeadHandoff struct {
	ID         string               `json:"id"`
	From       string               `json:"from,omitempty"`
	FromName   string               `json:"from_name,omitempty"`
	To         string               `json:"to"`
	ToName     string               `json:"to_name,omitempty"`
	At         time.Time            `json:"at"`
	Status     string               `json:"status"`
	AckedAt    time.Time            `json:"acked_at,omitempty"`
	Error      string               `json:"error,omitempty"`
	Snapshot   *LeadHandoffSnapshot `json:"snapshot,omitempty"`
	SnapshotAt time.Time            `json:"snapshot_at,omitempty"`
}

// LeadHandoffState is the product-wide switch journal. Lead is the last
// observed selection; Pending is the latest switch record (also after it became
// active, so a fresh agent context can receive it again).
type LeadHandoffState struct {
	Version   int           `json:"version"`
	Lead      string        `json:"lead,omitempty"`
	LeadName  string        `json:"lead_name,omitempty"`
	LeadSince time.Time     `json:"lead_since,omitempty"`
	Pending   *LeadHandoff  `json:"pending,omitempty"`
	History   []LeadHandoff `json:"history,omitempty"`
}

// LeadHandoffStatus is what `bothouse handoff status` and GET /handoff/status
// return: the live selection plus the persisted switch record.
type LeadHandoffStatus struct {
	CurrentLead string        `json:"current_lead,omitempty"`
	CurrentName string        `json:"current_name,omitempty"`
	SelectedAt  string        `json:"selected_at,omitempty"`
	LeadSince   time.Time     `json:"lead_since,omitempty"`
	Handoff     *LeadHandoff  `json:"handoff,omitempty"`
	History     []LeadHandoff `json:"history,omitempty"`
}

// LeadHandoffSnapshot is the self-contained picture recorded at switch time.
// Everything here came from durable bridge records; the optional model summary
// is only a task-card field written by an agent, never the source of task state.
type LeadHandoffSnapshot struct {
	GeneratedAt    time.Time              `json:"generated_at"`
	Tasks          []LeadHandoffTask      `json:"tasks,omitempty"`
	Workspaces     []LeadHandoffWorkspace `json:"workspaces,omitempty"`
	Questions      []LeadHandoffQuestion  `json:"questions,omitempty"`
	TaskTotal      int                    `json:"task_total,omitempty"`
	WorkspaceTotal int                    `json:"workspace_total,omitempty"`
	QuestionTotal  int                    `json:"question_total,omitempty"`
	Missing        []string               `json:"missing,omitempty"`
	Sources        []string               `json:"sources,omitempty"`
}

// LeadHandoffTask is a compact, public copy of one task card.
type LeadHandoffTask struct {
	TaskID          string             `json:"task_id"`
	Title           string             `json:"title"`
	Agent           string             `json:"agent,omitempty"`
	State           TaskState          `json:"state"`
	FactStage       FactStage          `json:"fact_stage"`
	RequiredSummary string             `json:"required_summary,omitempty"`
	LatestProgress  string             `json:"latest_progress,omitempty"`
	NextSteps       string             `json:"next_steps,omitempty"`
	ResultSummary   string             `json:"result_summary,omitempty"`
	Verification    string             `json:"verification_result,omitempty"`
	DeliverableURL  string             `json:"deliverable_url,omitempty"`
	CreatedAt       time.Time          `json:"created_at,omitempty"`
	UpdatedAt       time.Time          `json:"updated_at,omitempty"`
	Members         []TaskMember       `json:"members,omitempty"`
	Relays          []LeadHandoffRelay `json:"relays,omitempty"`
	Events          []TaskEvent        `json:"events,omitempty"`
	Source          string             `json:"source,omitempty"`
}

// LeadHandoffRelay is one task relay receipt without its response body: the
// next lead needs to know whether a dispatch is unresolved, not to re-read or
// re-run the member's answer.
type LeadHandoffRelay struct {
	Target  string `json:"target"`
	Status  string `json:"status"`
	LastSeq int64  `json:"last_seq,omitempty"`
	Error   string `json:"error,omitempty"`
}

// LeadHandoffWorkspace is one open or parked workspace handoff.
type LeadHandoffWorkspace struct {
	ID     string    `json:"id"`
	Name   string    `json:"name,omitempty"`
	Chat   string    `json:"chat"`
	Task   string    `json:"task,omitempty"`
	Owner  string    `json:"owner,omitempty"`
	At     time.Time `json:"at,omitempty"`
	Due    time.Time `json:"due,omitempty"`
	Parked bool      `json:"parked,omitempty"`
	Source string    `json:"source,omitempty"`
}

// LeadHandoffQuestion is one forwarded workspace [ask] still waiting for the user.
type LeadHandoffQuestion struct {
	ID         string    `json:"id"`
	Bot        string    `json:"bot,omitempty"`
	Platform   string    `json:"platform,omitempty"`
	Workspace  string    `json:"workspace,omitempty"`
	Parent     string    `json:"parent,omitempty"`
	SessionKey string    `json:"session_key,omitempty"`
	Text       string    `json:"text"`
	At         time.Time `json:"at,omitempty"`
	Source     string    `json:"source,omitempty"`
}

type leadSelectionFull struct {
	Lead string `json:"lead"`
	Name string `json:"name,omitempty"`
	At   string `json:"at,omitempty"`
}

func leadHandoffPath(dataDir string) string {
	return filepath.Join(dataDir, leadHandoffFileName)
}

// readLeadSelectionFull reads the product-wide lead.json without the
// "unknown role falls back to the configured lead" rule: a handoff record keeps
// the literal selection, so a removed role stays visible as missing instead of
// silently becoming another lead.
func readLeadSelectionFull(dataDir string) (leadSelectionFull, bool) {
	if dataDir == "" {
		return leadSelectionFull{}, false
	}
	b, err := os.ReadFile(filepath.Join(dataDir, "lead.json"))
	if err != nil {
		return leadSelectionFull{}, false
	}
	var sel leadSelectionFull
	if json.Unmarshal(b, &sel) != nil || strings.TrimSpace(sel.Lead) == "" {
		return leadSelectionFull{}, false
	}
	sel.Lead = strings.TrimSpace(sel.Lead)
	sel.Name = strings.TrimSpace(sel.Name)
	sel.At = strings.TrimSpace(sel.At)
	return sel, true
}

func parseLeadSelectionAt(raw string, fallback time.Time) time.Time {
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "01-02 15:04:05"} {
		if t, err := time.ParseInLocation(layout, raw, time.Local); err == nil {
			// The gate writes "%m-%d %H:%M:%S" without a year; use the current
			// year rather than Go's year 0.
			if t.Year() == 0 {
				now := time.Now()
				t = time.Date(now.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.Local)
			}
			return t.UTC()
		}
	}
	return fallback
}

// ReadLeadHandoffState returns the persisted switch journal. A missing or
// invalid file is an empty journal, not an error: a first switch must still work.
func ReadLeadHandoffState(dataDir string) (*LeadHandoffState, error) {
	if dataDir == "" {
		return nil, errors.New("handoff: data directory is required")
	}
	leadHandoffMu.Lock()
	defer leadHandoffMu.Unlock()
	return readLeadHandoffStateLocked(dataDir), nil
}

func readLeadHandoffStateLocked(dataDir string) *LeadHandoffState {
	st := &LeadHandoffState{Version: leadHandoffVersion}
	b, err := os.ReadFile(leadHandoffPath(dataDir))
	if err != nil {
		return st
	}
	if err := json.Unmarshal(b, st); err != nil {
		slog.Warn("lead handoff: unreadable state, starting a new journal", "path", leadHandoffPath(dataDir), "error", err)
		return &LeadHandoffState{Version: leadHandoffVersion}
	}
	if st.Version == 0 {
		st.Version = leadHandoffVersion
	}
	return st
}

func saveLeadHandoffStateLocked(dataDir string, st *LeadHandoffState) error {
	st.Version = leadHandoffVersion
	b, err := json.Marshal(st)
	if err != nil {
		return fmt.Errorf("lead handoff: encode state: %w", err)
	}
	if err := AtomicWriteFile(leadHandoffPath(dataDir), b, 0o600); err != nil {
		return fmt.Errorf("lead handoff: write state: %w", err)
	}
	return nil
}

// LeadHandoffStatusFor reads the live selection and the switch journal for the
// CLI. It does not change anything.
func LeadHandoffStatusFor(dataDir string) (*LeadHandoffStatus, error) {
	st, err := ReadLeadHandoffState(dataDir)
	if err != nil {
		return nil, err
	}
	out := &LeadHandoffStatus{LeadSince: st.LeadSince, Handoff: st.Pending, History: st.History}
	if sel, ok := readLeadSelectionFull(dataDir); ok {
		out.CurrentLead, out.CurrentName, out.SelectedAt = sel.Lead, sel.Name, sel.At
	}
	return out, nil
}

// observeLeadSelection records a selection it has not seen yet. Every engine
// runs it before a turn; whichever engine sees the change first writes the same
// record, so a dead outgoing lead is not required. Returns the record when it
// belongs to this engine.
func (e *Engine) observeLeadSelection() *LeadHandoff {
	if e == nil || e.dataDir == "" || e.name == "" {
		return nil
	}
	sel, ok := readLeadSelectionFull(e.dataDir)
	if !ok {
		return nil
	}
	leadHandoffMu.Lock()
	defer leadHandoffMu.Unlock()
	st := readLeadHandoffStateLocked(e.dataDir)
	if st.Lead == sel.Lead {
		if st.Pending != nil && st.Pending.To == sel.Lead && st.Pending.Status != LeadHandoffSuperseded {
			return st.Pending
		}
		return nil
	}
	now := time.Now().UTC()
	if st.Lead == "" && sel.At == "" {
		// No switch has happened: this is the initial effective lead. Do not
		// invent a handoff the user did not ask for.
		st.Lead, st.LeadName, st.LeadSince = sel.Lead, sel.Name, now
		if st.LeadName == "" {
			st.LeadName = e.handoffProjectName(sel.Lead)
		}
		if err := saveLeadHandoffStateLocked(e.dataDir, st); err != nil {
			slog.Warn("lead handoff: save initial lead", "error", err)
		}
		return nil
	}
	from := st.Lead
	fromName := st.LeadName
	if from == "" {
		fromName = "未知（旧主已不可用）"
	}
	h := &LeadHandoff{
		ID:       "handoff-" + randomProgressID(8),
		From:     from,
		FromName: fromName,
		To:       sel.Lead,
		ToName:   sel.Name,
		At:       parseLeadSelectionAt(sel.At, now),
		Status:   LeadHandoffPending,
	}
	if h.ToName == "" {
		h.ToName = e.handoffProjectName(sel.Lead)
	}
	h.Snapshot = buildLeadHandoffSnapshot(e.dataDir, sel.Lead, from, e.handoffKnownProjects(from, sel.Lead), e.handoffChats())
	h.SnapshotAt = h.Snapshot.GeneratedAt
	if st.Pending != nil && st.Pending.Status != LeadHandoffSuperseded {
		st.Pending.Status = LeadHandoffSuperseded
		leadHandoffSetHistoryStatus(st, st.Pending.ID, LeadHandoffSuperseded, time.Time{})
	}
	st.Pending = h
	st.Lead, st.LeadName, st.LeadSince = sel.Lead, h.ToName, h.At
	st.History = append(st.History, *h)
	if len(st.History) > leadHandoffHistoryMax {
		st.History = st.History[len(st.History)-leadHandoffHistoryMax:]
	}
	if err := saveLeadHandoffStateLocked(e.dataDir, st); err != nil {
		slog.Warn("lead handoff: save switch", "error", err)
	}
	return h
}

// recordLeadHandoffFailure appends a failed attempt without changing lead.json.
// The task journals and the current handoff stay untouched.
func recordLeadHandoffFailure(dataDir, from, fromName, to, toName, reason string) {
	if dataDir == "" || to == "" {
		return
	}
	leadHandoffMu.Lock()
	defer leadHandoffMu.Unlock()
	st := readLeadHandoffStateLocked(dataDir)
	h := LeadHandoff{
		ID:       "handoff-" + randomProgressID(8),
		From:     from,
		FromName: fromName,
		To:       to,
		ToName:   toName,
		At:       time.Now().UTC(),
		Status:   LeadHandoffFailed,
		Error:    reason,
	}
	st.History = append(st.History, h)
	if len(st.History) > leadHandoffHistoryMax {
		st.History = st.History[len(st.History)-leadHandoffHistoryMax:]
	}
	if err := saveLeadHandoffStateLocked(dataDir, st); err != nil {
		slog.Warn("lead handoff: save failed attempt", "error", err)
	}
}

func leadHandoffSetHistoryStatus(st *LeadHandoffState, id, status string, ack time.Time) {
	for i := range st.History {
		if st.History[i].ID != id {
			continue
		}
		st.History[i].Status = status
		if !ack.IsZero() {
			st.History[i].AckedAt = ack
		}
		return
	}
}

func (e *Engine) handoffProjectName(project string) string {
	if project == "" {
		return ""
	}
	if project == e.name {
		return e.DisplayName()
	}
	if e.relayManager != nil {
		e.relayManager.mu.RLock()
		target := e.relayManager.engines[project]
		e.relayManager.mu.RUnlock()
		if target != nil {
			return target.DisplayName()
		}
	}
	return project
}

func (e *Engine) handoffKnownProjects(extra ...string) map[string]bool {
	known := map[string]bool{e.name: true}
	for _, name := range extra {
		if name != "" {
			known[name] = true
		}
	}
	if e.relayManager != nil {
		for _, name := range e.relayManager.ListEngineNames() {
			known[name] = true
		}
	}
	if e.team != nil && e.team.dir != "" {
		files, _ := filepath.Glob(filepath.Join(e.team.dir, "*"+teamStatusFileExt))
		for _, path := range files {
			known[strings.TrimSuffix(filepath.Base(path), teamStatusFileExt)] = true
		}
	}
	return known
}

// handoffChats limits workspace and [ask] records to chats this lead actually
// works in. Empty means "not known yet" and the caller shows the records with
// an explicit scope note.
func (e *Engine) handoffChats() map[string]bool {
	out := map[string]bool{}
	for _, chat := range e.teamLeadChats() {
		out[chat] = true
	}
	return out
}

// BuildLeadHandoffSnapshot builds the operator-facing snapshot without an
// engine's team filter. `bothouse handoff show` uses it; live injection uses the
// engine-scoped variant so only this team's projects/chats appear.
func BuildLeadHandoffSnapshot(dataDir, self, from string) (*LeadHandoffSnapshot, error) {
	if dataDir == "" {
		return nil, errors.New("handoff: data directory is required")
	}
	return buildLeadHandoffSnapshot(dataDir, self, from, nil, nil), nil
}

func buildLeadHandoffSnapshot(dataDir, self, from string, known, chats map[string]bool) *LeadHandoffSnapshot {
	now := time.Now().UTC()
	snap := &LeadHandoffSnapshot{GeneratedAt: now}
	var allTasks []LeadHandoffTask
	paths, _ := filepath.Glob(filepath.Join(dataDir, "public-progress", "*", "*.json"))
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var rec progressRecord
		if json.Unmarshal(b, &rec) != nil || rec.Task == nil {
			continue
		}
		agent := rec.Task.Agent
		if known != nil && !known[agent] && agent != self && agent != from {
			continue
		}
		if !leadHandoffTaskWanted(rec, now) {
			continue
		}
		allTasks = append(allTasks, leadHandoffTaskFromRecord(dataDir, path, rec))
	}
	sort.SliceStable(allTasks, func(i, j int) bool {
		ri, rj := leadHandoffTaskRank(allTasks[i].State), leadHandoffTaskRank(allTasks[j].State)
		if ri != rj {
			return ri < rj
		}
		return allTasks[i].UpdatedAt.After(allTasks[j].UpdatedAt)
	})
	snap.TaskTotal = len(allTasks)
	if len(allTasks) > leadHandoffMaxTasks {
		allTasks = allTasks[:leadHandoffMaxTasks]
		snap.Missing = append(snap.Missing, fmt.Sprintf("任务较多：另有 %d 项仅在各自任务卡中，未复制进本交接。", snap.TaskTotal-leadHandoffMaxTasks))
	}
	snap.Tasks = allTasks

	wsPath := filepath.Join(dataDir, teamWorkspaceFile)
	if b, err := os.ReadFile(wsPath); err == nil {
		var st teamWorkspaceState
		if json.Unmarshal(b, &st) == nil {
			names := map[string]string{}
			for _, list := range st.Parents {
				for _, w := range list {
					names[w.ID] = w.Name
				}
			}
			for key, list := range st.Handoffs {
				wsID := key
				if i := strings.Index(key, ":"); i >= 0 {
					wsID = key[i+1:]
				}
				for _, h := range list {
					if !h.Closed.IsZero() {
						continue
					}
					if len(chats) > 0 && !chats[h.Chat] {
						continue
					}
					snap.Workspaces = append(snap.Workspaces, LeadHandoffWorkspace{
						ID:     wsID,
						Name:   names[wsID],
						Chat:   h.Chat,
						Task:   h.Title,
						Owner:  h.Owner,
						At:     h.At,
						Due:    h.Due,
						Parked: !h.Parked.IsZero(),
						Source: teamWorkspaceFile,
					})
				}
			}
			sort.SliceStable(snap.Workspaces, func(i, j int) bool { return snap.Workspaces[i].At.After(snap.Workspaces[j].At) })
		}
	}
	snap.WorkspaceTotal = len(snap.Workspaces)

	askPaths, _ := filepath.Glob(filepath.Join(dataDir, "team-asks", "*.json"))
	for _, path := range askPaths {
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var list []*teamAsk
		if json.Unmarshal(b, &list) != nil {
			continue
		}
		for _, a := range list {
			if a == nil || a.ID == "" {
				continue
			}
			if len(chats) > 0 && !chats[a.Parent] {
				continue
			}
			snap.Questions = append(snap.Questions, LeadHandoffQuestion{
				ID:         a.ID,
				Bot:        a.Bot,
				Platform:   a.Platform,
				Workspace:  a.Workspace,
				Parent:     a.Parent,
				SessionKey: a.SessionKey,
				Text:       leadHandoffCut(leadHandoffAskText(a), leadHandoffQuestionRunes),
				At:         a.At,
				Source:     leadHandoffRel(dataDir, path),
			})
		}
	}
	sort.SliceStable(snap.Questions, func(i, j int) bool { return snap.Questions[i].At.Before(snap.Questions[j].At) })
	snap.QuestionTotal = len(snap.Questions)

	snap.Missing = append(snap.Missing,
		"旧主的 CLI 内部 session、隐藏状态和正在运行的工具进程不在交接范围；新主从任务、工作区和 [ask] 记录接续。",
		"工具审批请求绑定旧主会话，不迁移、不会自动批准；旧主未决审批保持原状。",
		"没有写进任务卡或 [ask] 的对话决策无法恢复；已确认决策请以任务卡的要求、关键事件和结果记录为准。",
		"旧主未写入的模型总结不可得；以上任务状态和事实来自 bothouse 持久记录，未知项会明确标注。",
	)
	if len(snap.Tasks) == 0 {
		snap.Missing = append(snap.Missing, "没有可读取的任务卡记录（项目可能未启用 public_progress）。")
	}
	snap.Sources = leadHandoffSources(dataDir, len(paths) > 0, len(askPaths) > 0)
	return snap
}

func leadHandoffTaskWanted(rec progressRecord, now time.Time) bool {
	if rec.Task == nil {
		return false
	}
	if !rec.Closed && !IsTerminalState(rec.Task.State) {
		return true
	}
	return !rec.Task.UpdatedAt.IsZero() && now.Sub(rec.Task.UpdatedAt) <= leadHandoffRecent
}

func leadHandoffTaskRank(state TaskState) int {
	switch state {
	case TaskStateWaitingUser:
		return 0
	case TaskStateReceived, TaskStateInProgress:
		return 1
	case TaskStateResultReady:
		return 2
	case TaskStateFailed, TaskStateCancelled:
		return 3
	case TaskStateCompleted:
		return 4
	default:
		return 2
	}
}

func leadHandoffTaskFromRecord(dataDir, path string, rec progressRecord) LeadHandoffTask {
	t := rec.Task
	out := LeadHandoffTask{
		TaskID:          t.ID,
		Title:           t.Title,
		Agent:           t.Agent,
		State:           t.State,
		FactStage:       t.FactStage,
		RequiredSummary: t.RequiredSummary,
		LatestProgress:  t.LatestProgress,
		NextSteps:       t.NextSteps,
		ResultSummary:   t.ResultSummary,
		Verification:    t.VerificationResult,
		DeliverableURL:  t.DeliverableURL,
		CreatedAt:       t.CreatedAt,
		UpdatedAt:       t.UpdatedAt,
		Members:         append([]TaskMember(nil), t.Members...),
		Source:          leadHandoffRel(dataDir, path),
	}
	for _, relay := range rec.Relays {
		out.Relays = append(out.Relays, LeadHandoffRelay{Target: relay.Target, Status: relay.Status, LastSeq: relay.LastSeq, Error: relay.Error})
	}
	sort.SliceStable(out.Relays, func(i, j int) bool {
		if out.Relays[i].Target != out.Relays[j].Target {
			return out.Relays[i].Target < out.Relays[j].Target
		}
		return out.Relays[i].Status < out.Relays[j].Status
	})
	// Latest key facts, chronological. A result/report is what a successor must
	// see; ordinary progress is already in LatestProgress.
	var facts []TaskEvent
	for i := len(t.Events) - 1; i >= 0 && len(facts) < leadHandoffEventsPerTask; i-- {
		ev := t.Events[i]
		switch ev.Kind {
		case TaskEventRequirementChanged, TaskEventWaitingUser, TaskEventBlocked, TaskEventResultReady, TaskEventCompleted, TaskEventFailed:
			facts = append(facts, ev)
		}
	}
	for i, j := 0, len(facts)-1; i < j; i, j = i+1, j-1 {
		facts[i], facts[j] = facts[j], facts[i]
	}
	out.Events = facts
	return out
}

func leadHandoffAskText(a *teamAsk) string {
	var parts []string
	for _, chunk := range a.Forwarded {
		if i := strings.Index(chunk, "\n"); i >= 0 {
			if body := strings.TrimSpace(chunk[i+1:]); body != "" {
				parts = append(parts, body)
			}
		}
	}
	return strings.Join(parts, "")
}

func leadHandoffSources(dataDir string, hasTasks, hasAsks bool) []string {
	var out []string
	check := func(path string) {
		if _, err := os.Stat(filepath.Join(dataDir, path)); err == nil {
			out = append(out, path)
		}
	}
	check("lead.json")
	if hasTasks {
		out = append(out, "public-progress/*/*.json")
	}
	check(teamWorkspaceFile)
	if hasAsks {
		out = append(out, "team-asks/*.json")
	}
	check(leadHandoffFileName)
	return out
}

func leadHandoffRel(dataDir, path string) string {
	rel, err := filepath.Rel(dataDir, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return filepath.Base(path)
	}
	return rel
}

func leadHandoffCut(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n]) + "…"
}

// ---- turn context ----

// leadHandoffBlock returns the handoff text for this turn, or "". It runs only
// in a chat channel where this project is the current selected lead. A full
// record goes once per agent context; later turns get only what changed since
// the previous block, so results that arrive during or after the switch are
// still linked to their original task.
func (e *Engine) leadHandoffBlock(session *Session, sessionKey string) string {
	if e == nil || e.dataDir == "" || session == nil || sessionKey == "" {
		return ""
	}
	selected, ok := e.selectedTeamLead()
	if !ok || selected != e.name {
		return ""
	}
	chat := chatOf(sessionKey)
	if !e.leadHandoffChat(chat) {
		return ""
	}
	h := e.observeLeadSelection()
	if h == nil || h.To != e.name || (h.Status != LeadHandoffPending && h.Status != LeadHandoffActive) {
		return ""
	}
	sentID, sentAt := session.leadHandoffSent()
	now := time.Now().UTC()
	if sentID != h.ID {
		snap := h.Snapshot
		if snap == nil {
			snap = buildLeadHandoffSnapshot(e.dataDir, e.name, h.From, e.handoffKnownProjects(h.From, e.name), e.handoffChats())
		}
		text := renderLeadHandoffBlock(h, snap)
		if delta := buildLeadHandoffDelta(e.dataDir, e.name, h.From, snap.GeneratedAt, e.handoffKnownProjects(h.From, e.name), e.handoffChats()); delta != "" {
			text += "\n\n" + delta
		}
		e.ackLeadHandoff(h.ID, snap)
		session.UpdateTurnCtx(func(t *TurnCtxSent) {
			t.LeadHandoff, t.LeadHandoffAt = h.ID, now
		})
		return text
	}
	delta := buildLeadHandoffDelta(e.dataDir, e.name, h.From, sentAt, e.handoffKnownProjects(h.From, e.name), e.handoffChats())
	if delta == "" {
		return ""
	}
	session.UpdateTurnCtx(func(t *TurnCtxSent) {
		t.LeadHandoffAt = now
	})
	return delta
}

// leadHandoffChat: never inject task records into a private chat or a
// workspace; the lead's chat channels are where the team record belongs.
func (e *Engine) leadHandoffChat(chat string) bool {
	if chat == "" || e.sessions == nil {
		return false
	}
	if _, ok := e.workspaceParent(chat); ok {
		return false
	}
	for _, key := range e.sessions.UserKeys() {
		if chatOf(key) == chat {
			return true
		}
	}
	return false
}

func (s *Session) leadHandoffSent() (string, time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.TurnCtx == nil {
		return "", time.Time{}
	}
	return s.TurnCtx.LeadHandoff, s.TurnCtx.LeadHandoffAt
}

func (e *Engine) ackLeadHandoff(id string, snap *LeadHandoffSnapshot) {
	now := time.Now().UTC()
	leadHandoffMu.Lock()
	defer leadHandoffMu.Unlock()
	st := readLeadHandoffStateLocked(e.dataDir)
	if st.Pending == nil || st.Pending.ID != id {
		return
	}
	st.Pending.Status = LeadHandoffActive
	st.Pending.AckedAt = now
	st.Pending.Snapshot = snap
	st.Pending.SnapshotAt = snap.GeneratedAt
	leadHandoffSetHistoryStatus(st, id, LeadHandoffActive, now)
	if err := saveLeadHandoffStateLocked(e.dataDir, st); err != nil {
		slog.Warn("lead handoff: save acknowledgement", "error", err)
	}
}

// buildLeadHandoffDelta lists what changed after since: task key facts, new
// [ask]s and new workspace handoffs that still belong to the original tasks.
func buildLeadHandoffDelta(dataDir, self, from string, since time.Time, known, chats map[string]bool) string {
	if since.IsZero() {
		return ""
	}
	snap := buildLeadHandoffSnapshot(dataDir, self, from, known, chats)
	var lines []string
	for _, task := range snap.Tasks {
		hasNewEvent := false
		for _, ev := range task.Events {
			if ev.Timestamp.After(since) {
				hasNewEvent = true
				lines = append(lines, fmt.Sprintf("- [%s「%s」] %s：%s（%s）", task.TaskID, task.Title, leadHandoffEventLabel(ev.Kind), leadHandoffOneLine(ev.Summary), handoffTime(ev.Timestamp)))
			}
		}
		// The event window keeps only the latest key facts, so a routine update
		// after the switch can coexist with older events in that window. Use the
		// task timestamp, not "has any events", to decide whether it is new.
		if !hasNewEvent && task.UpdatedAt.After(since) {
			lines = append(lines, fmt.Sprintf("- [%s「%s」] 状态更新为%s：%s（%s）", task.TaskID, task.Title, taskStateLabel(task.State), leadHandoffOneLine(task.LatestProgress), handoffTime(task.UpdatedAt)))
		}
	}
	for _, q := range snap.Questions {
		if q.At.After(since) {
			lines = append(lines, fmt.Sprintf("- 新等待用户：%s（%s 提问，%s）：%s", q.ID, q.Bot, handoffTime(q.At), leadHandoffOneLine(q.Text)))
		}
	}
	for _, w := range snap.Workspaces {
		if w.At.After(since) {
			lines = append(lines, fmt.Sprintf("- 新工作区交接：%s「%s」← %s（%s）", leadHandoffWorkspaceName(w), w.Task, w.Chat, handoffTime(w.At)))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "【主角色交接 · 交接后更新（" + handoffTime(since) + " 之后，仍属原任务，不要重派）】\n" + strings.Join(lines, "\n")
}

// ---- rendering ----

func renderLeadHandoffBlock(h *LeadHandoff, snap *LeadHandoffSnapshot) string {
	if h == nil || snap == nil {
		return ""
	}
	var b strings.Builder
	from := h.From
	if from == "" {
		from = "未知"
	}
	fmt.Fprintf(&b, "【主角色交接 · bothouse 持久记录，旧主无需再回复】\n")
	fmt.Fprintf(&b, "当前有效主角色：%s（%s）。原主：%s（%s）。切换时间：%s。交接编号：%s。\n",
		h.ToName, h.To, h.FromName, from, handoffTime(h.At), h.ID)
	b.WriteString("接手规则：先按下面的任务 ID 核对在途工作；已经派出的活继续等原任务结果，不要重新派一遍；未验证的结果不要当成完成。旧主的迟到消息只留存，不再有协调权。\n")

	fmt.Fprintf(&b, "\n一、目标与任务状态（共 %d 项）\n", snap.TaskTotal)
	if len(snap.Tasks) == 0 {
		b.WriteString("- 没有可读取的任务卡记录。\n")
	}
	for _, t := range snap.Tasks {
		fmt.Fprintf(&b, "- [%s]「%s」状态：%s；事实阶段：%s；负责人：%s；更新：%s\n", t.TaskID, t.Title, taskStateLabel(t.State), factStageLabel(t.FactStage), leadHandoffAgent(t.Agent), handoffTime(t.UpdatedAt))
		if t.RequiredSummary != "" {
			fmt.Fprintf(&b, "  要求/约束：%s\n", leadHandoffOneLine(t.RequiredSummary))
		}
		if t.LatestProgress != "" {
			fmt.Fprintf(&b, "  最近进展：%s\n", leadHandoffOneLine(t.LatestProgress))
		}
		if t.NextSteps != "" {
			fmt.Fprintf(&b, "  下一步：%s\n", leadHandoffOneLine(t.NextSteps))
		}
		if t.ResultSummary != "" {
			label := "已有结果（待验收，不是已完成）"
			if t.State == TaskStateCompleted {
				label = "结果"
			}
			fmt.Fprintf(&b, "  %s：%s\n", label, leadHandoffOneLine(t.ResultSummary))
		}
		if t.Verification != "" || t.DeliverableURL != "" {
			fmt.Fprintf(&b, "  验证证据：%s%s\n", leadHandoffOneLine(t.Verification), leadHandoffURL(t.DeliverableURL))
		}
		for _, ev := range t.Events {
			fmt.Fprintf(&b, "  - %s：%s（%s）\n", leadHandoffEventLabel(ev.Kind), leadHandoffOneLine(ev.Summary), handoffTime(ev.Timestamp))
		}
		for _, m := range t.Members {
			fmt.Fprintf(&b, "  成员 %s：%s（更新 %s）%s\n", m.Name, memberStatusLabel(m.Status), handoffTime(m.UpdatedAt), leadHandoffParen(m.Summary))
		}
		for _, r := range t.Relays {
			fmt.Fprintf(&b, "  投递 → %s：%s%s%s\n", r.Target, r.Status, leadHandoffSeq(r.LastSeq), leadHandoffParen(r.Error))
		}
		if t.Source != "" {
			fmt.Fprintf(&b, "  来源：%s\n", t.Source)
		}
	}

	fmt.Fprintf(&b, "\n二、工作区在途（%d）\n", snap.WorkspaceTotal)
	if len(snap.Workspaces) == 0 {
		b.WriteString("- 无。\n")
	}
	for _, w := range snap.Workspaces {
		state := "进行中"
		if w.Parked {
			state = "已暂停，等待恢复"
		}
		fmt.Fprintf(&b, "- %s「%s」（%s）：任务「%s」；负责人 %s；开始 %s%s\n", state, leadHandoffWorkspaceName(w), w.ID, w.Task, leadHandoffAgent(w.Owner), handoffTime(w.At), leadHandoffDue(w.Due))
	}

	fmt.Fprintf(&b, "\n三、等待用户决定（%d）\n", snap.QuestionTotal)
	if len(snap.Questions) == 0 {
		b.WriteString("- 无。\n")
	}
	for _, q := range snap.Questions {
		fmt.Fprintf(&b, "- %s（%s 在工作区 %s 提问，聊天 %s，%s）：%s\n", q.ID, q.Bot, q.Workspace, q.Parent, handoffTime(q.At), leadHandoffOneLine(q.Text))
	}

	b.WriteString("\n四、权限与审批边界\n")
	b.WriteString("- 工具审批绑定旧主会话，不随交接迁移；旧主未决审批保持原状，不会自动批准。\n")
	b.WriteString("- 新主沿用自己项目的权限配置和平台 allow_from；本交接不扩大任何权限。\n")

	b.WriteString("\n五、未知与缺失\n")
	for _, m := range snap.Missing {
		fmt.Fprintf(&b, "- %s\n", m)
	}

	b.WriteString("\n六、下一步\n")
	b.WriteString("- 先核对在途任务的最新结果和等待项；用户回答待决问题后再推进。结果仍按原任务 ID 关联。\n")
	b.WriteString("- 向用户回复时先用一句话确认：已接手 " + from + " → " + h.To + " 的交接，并说明你在等在途任务还是继续下一步。\n")

	b.WriteString("\n七、记录来源与覆盖\n")
	if len(snap.Sources) == 0 {
		b.WriteString("- 无持久记录。\n")
	}
	for _, s := range snap.Sources {
		fmt.Fprintf(&b, "- %s\n", s)
	}
	return b.String()
}

func leadHandoffAgent(name string) string {
	if strings.TrimSpace(name) == "" {
		return "未知"
	}
	return name
}

func leadHandoffWorkspaceName(w LeadHandoffWorkspace) string {
	if w.Name != "" {
		return w.Name
	}
	return w.ID
}

func leadHandoffURL(u string) string {
	if strings.TrimSpace(u) == "" {
		return ""
	}
	return "（" + u + "）"
}

func leadHandoffParen(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return " — " + leadHandoffOneLine(s)
}

func leadHandoffSeq(seq int64) string {
	if seq == 0 {
		return ""
	}
	return fmt.Sprintf(" seq %d", seq)
}

func leadHandoffDue(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return "；下次检查 " + handoffTime(t)
}

func leadHandoffOneLine(s string) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if s == "" {
		return "（无摘要）"
	}
	return strings.ReplaceAll(s, "\n", " / ")
}

func handoffTime(t time.Time) string {
	if t.IsZero() {
		return "未知"
	}
	return t.Local().Format("2006-01-02 15:04")
}

// LeadHandoffStatusLabel is the user-facing label for a persisted status.
func LeadHandoffStatusLabel(status string) string { return leadHandoffStatusLabel(status) }

func leadHandoffStatusLabel(status string) string {
	switch status {
	case LeadHandoffPending:
		return "交接进行中（等待新主确认）"
	case LeadHandoffActive:
		return "交接已生效（新主已接手）"
	case LeadHandoffFailed:
		return "交接失败"
	case LeadHandoffSuperseded:
		return "已被下一次切换取代"
	default:
		return status
	}
}

func taskStateLabel(s TaskState) string {
	switch s {
	case TaskStateReceived:
		return "已接收"
	case TaskStateInProgress:
		return "进行中"
	case TaskStateWaitingUser:
		return "等待用户"
	case TaskStateResultReady:
		return "已有结果待验收"
	case TaskStateCompleted:
		return "已完成"
	case TaskStateFailed:
		return "失败"
	case TaskStateCancelled:
		return "已取消"
	default:
		if s == "" {
			return "未知"
		}
		return string(s)
	}
}

func factStageLabel(s FactStage) string {
	switch s {
	case FactStageReceived:
		return "已接收"
	case FactStageCodeModified:
		return "代码已改"
	case FactStagePROpened:
		return "PR已提交"
	case FactStageCIPassed:
		return "CI通过"
	case FactStageMerged:
		return "已合并"
	case FactStageDeployed:
		return "已部署"
	case FactStageVerified:
		return "真人已验收"
	default:
		if s == "" {
			return "未知"
		}
		return string(s)
	}
}

func memberStatusLabel(s string) string {
	switch s {
	case "queued":
		return "待接单"
	case "running":
		return "执行中"
	case "waiting":
		return "等待中"
	case "completed":
		return "已完成"
	case "failed":
		return "失败"
	case "cancelled":
		return "已取消"
	case "interrupted":
		return "已中断"
	default:
		if s == "" {
			return "未知"
		}
		return s
	}
}

func leadHandoffEventLabel(k TaskEventKind) string {
	switch k {
	case TaskEventRequirementChanged:
		return "要求变更"
	case TaskEventWaitingUser:
		return "等待用户"
	case TaskEventBlocked:
		return "阻塞"
	case TaskEventResultReady:
		return "结果待验收"
	case TaskEventCompleted:
		return "完成"
	case TaskEventFailed:
		return "失败"
	default:
		return string(k)
	}
}

// BuildLeadHandoffText renders the stored (or latest) handoff for the CLI. It
// does not acknowledge anything; acknowledgement happens only when a live
// engine assembles the new lead's next turn.
func BuildLeadHandoffText(dataDir, project string) (string, error) {
	st, err := ReadLeadHandoffState(dataDir)
	if err != nil {
		return "", err
	}
	h := st.Pending
	if project != "" && (h == nil || h.To != project) {
		h = nil
		for i := len(st.History) - 1; i >= 0; i-- {
			if st.History[i].To == project {
				h = &st.History[i]
				break
			}
		}
	}
	if h == nil {
		return "没有交接记录。当前主角色由 lead.json 和团队配置决定。", nil
	}
	snap := h.Snapshot
	if snap == nil {
		snap, err = BuildLeadHandoffSnapshot(dataDir, h.To, h.From)
		if err != nil {
			return "", err
		}
	}
	return renderLeadHandoffBlock(h, snap), nil
}
