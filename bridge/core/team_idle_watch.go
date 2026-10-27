package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Idle wakeups are armed by terminal events, never by the periodic progress scan.
// Fifteen seconds lets the completed turn unlock and queued work start first.
const watchTurnEndDelay = 15 * time.Second

type watchIdleState struct {
	Returned bool      `json:"returned,omitempty"`
	Ended    time.Time `json:"ended,omitzero"`
	Wakes    int       `json:"wakes,omitempty"`
	Reported bool      `json:"reported,omitempty"`
}

type idleAssignment struct {
	key    string
	h      TeamHandoff
	script bool
}

func (e *Engine) watchEngines() []*Engine {
	if e.relayManager == nil {
		return []*Engine{e}
	}
	e.relayManager.mu.RLock()
	defer e.relayManager.mu.RUnlock()
	out := make([]*Engine, 0, len(e.relayManager.engines))
	for _, x := range e.relayManager.engines {
		out = append(out, x)
	}
	return out
}

func (e *Engine) watchOwns(p Platform, owner string) bool {
	if owner == "" {
		return e.isTeamLead()
	}
	if owner == e.name || owner == e.DisplayName() {
		return true
	}
	m, ok := p.(SelfMentioner)
	return ok && watchOwnerID(m.SelfMention()) == watchOwnerID(owner)
}

func (e *Engine) watchTarget(key, owner string) *Engine {
	plat, _, _ := strings.Cut(key, ":")
	for _, x := range e.watchEngines() {
		if p := x.lookupReadyPlatform(plat); p != nil && x.watchOwns(p, owner) {
			return x
		}
	}
	return nil
}

func (e *Engine) watchBusy(key string) bool {
	managers := []*SessionManager{e.sessions}
	if e.workspacePool != nil {
		for _, ws := range e.workspacePool.All() {
			ws.mu.Lock()
			managers = append(managers, ws.sessions)
			ws.mu.Unlock()
		}
	}
	for _, manager := range managers {
		if manager == nil {
			continue
		}
		for _, k := range manager.UserKeys() {
			if teamChatKey(k) == key {
				for _, s := range manager.ListSessions(k) {
					if s.Busy() {
						return true
					}
				}
			}
		}
	}
	return false
}

func (e *Engine) updateIdle(a idleAssignment, f func(*TeamHandoff)) (TeamHandoff, bool) {
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)
	rows := st.Handoffs[a.key]
	if a.script {
		rows = st.ScriptWatches[a.key]
	}
	for i := range rows {
		h := &rows[i]
		if h.At.Equal(a.h.At) && h.Chat == a.h.Chat && h.Owner == a.h.Owner && teamHandoffOpen(*h) {
			f(h)
			if err := saveTeamWorkspacesLocked(path, st); err != nil {
				slog.Error("idle watch: save failed", "workspace", a.key, "error", err)
				return TeamHandoff{}, false
			}
			return *h, true
		}
	}
	return TeamHandoff{}, false
}

// watchTurnEnded runs before finishPublicProgress: automatic card completion is
// not a deliberate result. A report, handback or explicit result ends the watch.
func (e *Engine) watchTurnEnded(p Platform, key, text string, worked, cardResult bool) {
	if p == nil || e.dataDir == "" {
		return
	}
	key = teamChatKey(key)
	// Timer wrappers may omit optional platform capabilities.
	if raw := e.lookupReadyPlatform(p.Name()); raw != nil {
		p = raw
	}
	text = strings.TrimSpace(text)
	first, _, _ := strings.Cut(text, "\n")
	accepted := strings.HasPrefix(strings.TrimSpace(first), "【接】")
	// A stale waiting-user card cannot turn a fresh acceptance into a handback.
	returned := cardResult && !accepted || strings.HasPrefix(strings.TrimSpace(text), "[report]") ||
		strings.HasPrefix(strings.TrimSpace(text), "【交回】")
	// A validated user question waits for the user's answer, not an idle wake.
	if kind, body, ok := parseExitKind(text); ok && kind == exitKindAsk && askEvidenceProblems(body) == nil {
		returned = true
	}
	title := strings.TrimSpace(strings.TrimPrefix(first, "【接】"))
	chat := key
	if parent, ok := e.WorkspaceParent(key); ok {
		chat = parent
	}
	if accepted && e.team != nil {
		// Acceptance is new work, including when the board still says 等用户.
		// Do not let that old status hide this turn or a later human reply.
		items := placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir))
		taskID := 0
		for _, field := range strings.Fields(strings.TrimPrefix(first, "【接】")) {
			if id, err := strconv.Atoi(strings.TrimPrefix(field, "#")); strings.HasPrefix(field, "#") && err == nil {
				taskID = id
				break
			}
		}
		var picked *teamTaskBoardItem
		for i := range items {
			it := &items[i]
			if it.own != key || it.wsEnded || it.Paused != "" && !teamTaskBoardWaitUser.MatchString(it.PauseWhy) {
				continue
			}
			who := whoInWorkspace(*it)
			if who != e.name && who != e.DisplayName() {
				continue
			}
			if picked == nil || it.ID > picked.ID {
				picked = it
			}
			if taskID == it.ID {
				picked = it
				break
			}
		}
		if picked != nil {
			title = fmt.Sprintf("#%d %s", picked.ID, picked.What)
			if picked.parent != "" {
				chat = picked.parent
			}
		}
	}
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	var assignments []idleAssignment
	for _, script := range []bool{false, true} {
		rows := st.Handoffs[key]
		if script {
			rows = st.ScriptWatches[key]
		}
		for _, h := range rows {
			if teamHandoffOpen(h) && !h.Idle.Returned && !h.Due.IsZero() && e.watchOwns(p, h.Owner) {
				assignments = append(assignments, idleAssignment{key, h, script})
			}
		}
	}
	// A direct acceptance in a chat has no handoff/d10 registration. Register
	// it from this terminal event, using the same one-shot wake path.
	if accepted && len(assignments) == 0 && e.team != nil {
		owner := e.name
		if m, ok := p.(SelfMentioner); ok && m.SelfMention() != "" {
			owner = m.SelfMention()
		}
		sender := e.name
		for _, x := range e.watchEngines() {
			if x.isTeamLead() {
				sender = x.name
				break
			}
		}
		now := time.Now()
		h := TeamHandoff{Chat: chat, At: now, Due: now.Add(watchCheckAfter()), Owner: owner, Title: shortLabel(title, teamTaskMaxRunes), Sender: sender}
		if st.ScriptWatches == nil {
			st.ScriptWatches = make(map[string][]TeamHandoff)
		}
		st.ScriptWatches[key] = append(st.ScriptWatches[key], h)
		if err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), st); err != nil {
			slog.Error("idle watch: register acceptance failed", "workspace", key, "error", err)
		} else {
			assignments = append(assignments, idleAssignment{key, h, true})
		}
	}
	teamWorkspaceStore.mu.Unlock()
	for _, a := range assignments {
		h, ok := e.updateIdle(a, func(h *TeamHandoff) {
			h.Idle.Returned = returned
			h.Idle.Ended = time.Now()
			if worked {
				h.Idle.Wakes = 0
				h.Idle.Reported = false
			}
		})
		if ok && !returned {
			a.h = h
			e.armIdleWake(a)
		}
	}
}

func (e *Engine) armIdleWake(a idleAssignment) {
	time.AfterFunc(watchTurnEndDelay, func() { e.fireIdleWake(a) })
}

func (e *Engine) fireIdleWake(a idleAssignment) {
	if e.ctx.Err() != nil || e.watchBusy(a.key) {
		return
	}
	w := newHandoffWatch(e)
	if running, _ := w.workspaceBackgroundProgress(a.key, a.h.Idle.Ended); running {
		return // native background completion supplies the next terminal event
	}
	escalate, wake := false, false
	h, ok := e.updateIdle(a, func(h *TeamHandoff) {
		// Ignore timers belonging to a prior turn or a task already handed back.
		if h.Idle.Returned || h.Idle.Reported || h.Idle.Wakes != a.h.Idle.Wakes || !h.Idle.Ended.Equal(a.h.Idle.Ended) {
			return
		}
		if h.Idle.Wakes >= 2 {
			h.Idle.Reported = true
			escalate = true
		} else {
			h.Idle.Wakes++
			wake = true
		}
	})
	if !ok || (!wake && !escalate) {
		return
	}
	plat, _, _ := strings.Cut(a.key, ":")
	sender := e
	for _, x := range e.watchEngines() {
		if (h.Sender != "" && x.name == h.Sender) || (h.Sender == "" && x.isTeamLead()) {
			sender = x
			break
		}
	}
	p := sender.lookupReadyPlatform(plat)
	if p == nil {
		slog.Warn("idle watch: sender platform unavailable", "workspace", a.key)
		return
	}
	w = newHandoffWatch(sender)
	if escalate {
		text := sender.i18n.Tf(MsgWatchIdleEscalate, watchMention(plat, h.Owner), h.Title)
		if err := w.send(p, h.Chat, text); err != nil {
			slog.Warn("idle watch: escalation failed", "error", err)
		}
		sender.wakeWatchRole(h.Chat, text, h.Title)
		return
	}
	owner := h.Owner
	if m, ok := e.lookupReadyPlatform(plat).(SelfMentioner); ok && m.SelfMention() != "" {
		owner = m.SelfMention()
	}
	text := strings.TrimSpace(watchMention(plat, owner) + " " + sender.i18n.Tf(MsgWatchResume, h.Title))
	if err := w.send(p, a.key, text); err != nil {
		slog.Warn("idle watch: wake post failed", "error", err)
	}
	// A bot's own post cannot wake it. Deliver locally as well; when another
	// bot posts the mention, the platform supplies the normal user turn.
	if sender == e {
		e.wakeWatchRole(a.key, text, h.Title)
	}
	a.h = h
	e.armIdleWake(a) // two wake attempts, then one escalation; not a polling loop
}

func (e *Engine) wakeWatchRole(key, text, title string) {
	go func() {
		silent := true
		if err := e.ExecuteTimerJob(&TimerJob{SessionKey: key, Prompt: text, Description: title, Silent: &silent, Handoff: true}); err != nil {
			slog.Warn("idle watch: local wake failed", "error", err)
		}
	}()
}

func (e *Engine) watchCardResult(state *interactiveState) bool {
	if e.publicProgress == nil {
		return false
	}
	state.mu.Lock()
	token := state.publicProgressRun
	state.mu.Unlock()
	p := e.publicProgress
	p.mu.Lock()
	r := p.runs[token]
	p.mu.Unlock()
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.record.Task.State == TaskStateResultReady || r.record.Task.State == TaskStateWaitingUser
}

// /team/watch lets d10 register its assignment with terminal-event wakeups.
// Its existing ten-minute timer remains responsible for progress deadlines.
func (s *APIServer) handleTeamIdleWatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Project string `json:"project"`
		Session string `json:"session_key"`
		Owner   string `json:"owner"`
		Title   string `json:"title"`
		Since   int64  `json:"since"`
		Action  string `json:"action"` // register, status, wake, close
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil || req.Project == "" || req.Session == "" || req.Owner == "" || req.Since <= 0 {
		http.Error(w, "project, session_key, owner and since required", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	sender := s.engines[req.Project]
	s.mu.RUnlock()
	if sender == nil {
		http.Error(w, "unknown project", http.StatusConflict)
		return
	}
	key := teamChatKey(req.Session)
	lead := s.teamWorkspaceEngine()
	covered := lead != nil && !lead.teamWorkspaceWatchDue(key).IsZero()
	target := sender.watchTarget(key, req.Owner)
	if target == nil {
		http.Error(w, "assigned role is not connected to this bridge", http.StatusConflict)
		return
	}
	// G6's task relay already delivers every terminal outcome to its task
	// thread, including errors. It remains the single keeper of that dispatch.
	if p := sender.publicProgress; p != nil {
		p.mu.Lock()
		runs := make([]*publicRun, 0, len(p.records))
		for _, run := range p.records {
			runs = append(runs, run)
		}
		p.mu.Unlock()
		for _, run := range runs {
			run.mu.Lock()
			watched := false
			for _, receipt := range run.record.Relays {
				execution := run.record.Task.SessionKey
				if receipt.Workspace != "" {
					execution = receipt.Workspace
				}
				if teamChatKey(execution) == key && receipt.Target == target.name && receipt.Status == "running" && !receipt.WatchDone && !receipt.WatchDue.IsZero() {
					watched = true
					break
				}
			}
			run.mu.Unlock()
			if watched {
				apiJSON(w, http.StatusOK, map[string]any{"covered": true})
				return
			}
		}
	}
	chat := key
	if lead != nil {
		if parent, ok := lead.WorkspaceParent(key); ok {
			chat = parent
		}
	}
	at := time.Unix(req.Since, 0)
	teamWorkspaceStore.mu.Lock()
	path := teamWorkspacePath(sender.dataDir)
	st := loadTeamWorkspacesLocked(path)
	if covered {
		for _, h := range st.Handoffs[key] {
			if teamHandoffOpen(h) && !h.Idle.Returned && (watchOwnerID(h.Owner) == watchOwnerID(req.Owner) || h.Owner == "" && target.isTeamLead()) {
				teamWorkspaceStore.mu.Unlock()
				apiJSON(w, http.StatusOK, map[string]any{"covered": true})
				return
			}
		}
	}
	if st.ScriptWatches == nil {
		st.ScriptWatches = map[string][]TeamHandoff{}
	}
	var found *TeamHandoff
	for i := range st.ScriptWatches[key] {
		h := &st.ScriptWatches[key][i]
		if h.Owner == req.Owner && h.Sender == req.Project && h.At.Equal(at) {
			found = h
		}
	}
	if found == nil && req.Action == "register" {
		// Reassignment supersedes the prior d10 for this role in this channel.
		for i := range st.ScriptWatches[key] {
			if h := &st.ScriptWatches[key][i]; h.Owner == req.Owner {
				h.Closed = time.Now()
			}
		}
		h := TeamHandoff{Chat: chat, Owner: req.Owner, Title: req.Title, Sender: req.Project, At: at, Due: at.Add(watchCheckAfter())}
		st.ScriptWatches[key] = append(st.ScriptWatches[key], h)
		found = &st.ScriptWatches[key][len(st.ScriptWatches[key])-1]
	}
	if found == nil {
		teamWorkspaceStore.mu.Unlock()
		http.Error(w, "assignment not registered", http.StatusNotFound)
		return
	}
	switch req.Action {
	case "register", "status":
	case "close":
		found.Closed = time.Now()
	case "wake":
		if found.Idle.Ended.IsZero() {
			found.Idle.Ended = time.Now()
		}
	default:
		teamWorkspaceStore.mu.Unlock()
		http.Error(w, "invalid action", http.StatusBadRequest)
		return
	}
	h := *found
	err := saveTeamWorkspacesLocked(path, st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		http.Error(w, fmt.Sprint(err), http.StatusInternalServerError)
		return
	}
	if req.Action == "wake" && teamHandoffOpen(h) && !h.Idle.Returned && !h.Idle.Reported {
		target.armIdleWake(idleAssignment{key, h, true})
	}
	apiJSON(w, http.StatusOK, map[string]any{"covered": covered, "returned": h.Idle.Returned || !teamHandoffOpen(h), "busy": target.watchBusy(key)})
}
