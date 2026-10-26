package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
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
	if e.sessions == nil {
		return false
	}
	for _, k := range e.sessions.UserKeys() {
		if teamChatKey(k) == key {
			for _, s := range e.sessions.ListSessions(k) {
				if s.Busy() {
					return true
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
	returned := cardResult || strings.HasPrefix(strings.TrimSpace(text), "[report]") ||
		strings.HasPrefix(strings.TrimSpace(text), "【交回】")
	// A validated user question waits for the user's answer, not an idle wake.
	if kind, body, ok := parseExitKind(text); ok && kind == exitKindAsk && askEvidenceProblems(body) == nil {
		returned = true
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
	escalate, wake := false, false
	h, ok := e.updateIdle(a, func(h *TeamHandoff) {
		// Ignore timers belonging to a prior turn or a task already handed back.
		if h.Idle.Returned || h.Idle.Reported || !h.Idle.Ended.Equal(a.h.Idle.Ended) {
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
	w := newHandoffWatch(sender)
	if escalate {
		if err := w.send(p, h.Chat, "看门："+watchMention(plat, h.Owner)+"「"+h.Title+"」连续叫醒两次仍未继续，请主角色接手。"); err != nil {
			slog.Warn("idle watch: escalation failed", "error", err)
		}
		return
	}
	owner := h.Owner
	if owner == "" {
		if m, ok := e.lookupReadyPlatform(plat).(SelfMentioner); ok {
			owner = m.SelfMention()
		}
	}
	text := strings.TrimSpace(watchMention(plat, owner) + " 接着做 " + h.Title + "，不用回话")
	if err := w.send(p, a.key, text); err != nil {
		slog.Warn("idle watch: wake post failed", "error", err)
	}
	// A bot's own post cannot wake it. Deliver locally as well; when another
	// bot posts the mention, the platform supplies the normal user turn.
	if sender == e {
		go func() {
			if err := e.ExecuteTimerJob(&TimerJob{SessionKey: a.key, Prompt: text, Description: h.Title, Mute: true, Handoff: true}); err != nil {
				slog.Warn("idle watch: local wake failed", "error", err)
			}
		}()
	}
	a.h = h
	e.armIdleWake(a) // two wake attempts, then one escalation; not a polling loop
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Project == "" || req.Session == "" || req.Owner == "" || req.Since <= 0 {
		http.Error(w, "project, session_key, owner and since required", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	sender := s.engines[req.Project]
	s.mu.RUnlock()
	if sender == nil {
		http.Error(w, "unknown project", http.StatusNotFound)
		return
	}
	key := teamChatKey(req.Session)
	lead := s.teamWorkspaceEngine()
	if lead != nil && !lead.teamWorkspaceWatchDue(key).IsZero() {
		apiJSON(w, http.StatusOK, map[string]any{"covered": true})
		return
	}
	target := sender.watchTarget(key, req.Owner)
	if target == nil {
		http.Error(w, "assigned role is not connected to this bridge", http.StatusNotFound)
		return
	}
	at := time.Unix(req.Since, 0)
	teamWorkspaceStore.mu.Lock()
	path := teamWorkspacePath(sender.dataDir)
	st := loadTeamWorkspacesLocked(path)
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
		h := TeamHandoff{Chat: key, Owner: req.Owner, Title: req.Title, Sender: req.Project, At: at, Due: at.Add(watchCheckAfter())}
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
	apiJSON(w, http.StatusOK, map[string]any{"covered": false, "returned": h.Idle.Returned || !teamHandoffOpen(h), "busy": target.watchBusy(key)})
}
