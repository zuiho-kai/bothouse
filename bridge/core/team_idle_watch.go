package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
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

// A coordinator waiting for its dispatched work is not an idle worker.
// Receipts cover tracked relays; the peer's current incoming task identifies
// direct chat dispatches, which have no relay receipt.
func (e *Engine) watchDelegatedWork(key string) bool {
	if p := e.publicProgress; p != nil {
		p.mu.Lock()
		runs := make([]*publicRun, 0, len(p.records))
		for _, r := range p.records {
			runs = append(runs, r)
		}
		p.mu.Unlock()
		for _, r := range runs {
			r.mu.Lock()
			waiting := false
			if teamChatKey(r.record.Task.SessionKey) == key {
				for _, receipt := range r.record.Relays {
					if receipt.Target != e.name && receipt.Status == "running" && !receipt.WatchDone {
						waiting = true
						break
					}
				}
			}
			r.mu.Unlock()
			if waiting {
				return true
			}
		}
	}
	// The workspace lead coordinates its claimed workspace even after a
	// restart replaces the peer's original dispatch text with a resume prompt.
	_, workspace := e.WorkspaceParent(key)
	coordinator := workspace && e.isTeamLead()
	for _, peer := range e.watchEngines() {
		if peer == e || peer.team == nil {
			continue
		}
		peer.team.mu.Lock()
		waiting, dispatched := false, false
		for k, s := range peer.team.seen {
			task := strings.TrimSpace(strings.TrimPrefix(s.task, "♻️ 续做："))
			fromMe := strings.HasPrefix(task, "【"+e.DisplayName()+"】") ||
				strings.HasPrefix(task, "【"+e.name+"】")
			if teamChatKey(k) == key && (fromMe || coordinator) {
				dispatched = true
				if s.session != nil && s.session.Busy() {
					waiting = true
					break
				}
			}
		}
		peer.team.mu.Unlock()
		if waiting {
			return true
		}
		if dispatched {
			if running, _ := newHandoffWatch(peer).workspaceBackgroundProgress(key, time.Now()); running {
				return true
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

var watchTaskNumberRE = regexp.MustCompile(`(?:^|\s)#([0-9]+)`)
var watchHandbackPR = regexp.MustCompile(`github\.com/[^\s]+/pull/\d+`)

func watchTaskNumber(text string) int {
	m := watchTaskNumberRE.FindStringSubmatch(strings.TrimPrefix(text, "【接】"))
	if m == nil {
		return 0
	}
	id, _ := strconv.Atoi(m[1])
	return id
}

// Same handback policy as d10-fire.is_handback. Registered d10 callers read
// this decision through /team/watch rather than running a second classifier.
func watchIsHandback(text string) bool {
	text = strings.TrimSpace(watchLeadingMentions.ReplaceAllString(strings.TrimSpace(text), ""))
	if text == "" {
		return false
	}
	for _, prefix := range []string{"↪", "⏹", "📬"} {
		if strings.HasPrefix(text, prefix) {
			return false
		}
	}
	if strings.HasPrefix(text, "[report]") || strings.HasPrefix(text, "【交回】") || watchHandbackPR.MatchString(text) {
		return true
	}
	if strings.HasPrefix(text, "【接】") {
		return utf8.RuneCountInString(text) >= 300
	}
	// Length alone is not a handback (user 2026-10-28): a long progress note left the
	// handoff marked returned, so the watch skipped it and the workspace was never freed.
	return false
}

func watchBoardClosed(it teamTaskBoardItem) bool {
	for _, status := range []string{"已验收", "验收通过", "已收口", "已完成", "已交回", "已结束"} {
		if strings.Contains(it.Status, status) {
			return true
		}
	}
	return false
}

// watchTurnEnded runs before finishPublicProgress: automatic card completion is
// not a deliberate result. A report, handback or explicit result ends the watch.
// since: when the turn began (zero when unknown); a workspace handoff recorded from this chat
// after it means the accepted work now belongs to that workspace.
func (e *Engine) watchTurnEnded(p Platform, key, text string, worked, cardResult bool, since time.Time) {
	if e.finishWorkspaceReportTurn(key, text) {
		return // missing delivery owns this wake; do not also arm the idle watch
	}
	if p == nil || e.dataDir == "" {
		return
	}
	key = teamChatKey(key)
	// Timer wrappers may omit optional platform capabilities.
	if raw := e.lookupReadyPlatform(p.Name()); raw != nil {
		p = raw
	}
	text = strings.TrimSpace(watchLeadingMentions.ReplaceAllString(strings.TrimSpace(text), ""))
	first, _, _ := strings.Cut(text, "\n")
	accepted := strings.HasPrefix(strings.TrimSpace(first), "【接】")
	// A stale waiting-user card cannot turn a fresh acceptance into a handback.
	returned := cardResult && !accepted || watchIsHandback(text)
	// A validated user question waits for the user's answer, not an idle wake.
	asking := false
	if kind, body, ok := parseExitKind(text); ok && kind == exitKindAsk {
		returned = askEvidenceProblems(body) == nil
		asking = true
	} else if ok && returned && !e.exitHeadlineOK(body) && e.exitBounceCount(key) < exitRules.Bounce.WakeLimit {
		// A [report] bounced for its headline (forwardWorkspaceExit) is resent, not handed back yet.
		returned = false
	}
	title := strings.TrimSpace(StripMarkdown(strings.TrimPrefix(first, "【接】")))
	boardID := watchTaskNumber(StripMarkdown(first))
	boardActive := false
	boardClosed := false
	handedOff := false // the accepted work is in a workspace: its watch is the workspace's
	chat := key
	if parent, ok := e.WorkspaceParent(key); ok {
		chat = parent
	}
	if e.team != nil {
		items := placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir))
		var picked *teamTaskBoardItem
		for i := range items {
			it := &items[i]
			if boardID != 0 && boardID != it.ID {
				continue
			}
			if boardID == it.ID && watchBoardClosed(*it) {
				boardClosed = true
			}
			if boardID == it.ID && it.own != key && it.parent == key && !it.wsEnded {
				handedOff = true
			}
			if it.own != key || it.wsEnded || watchBoardClosed(*it) ||
				it.Paused != "" && !(accepted && teamTaskBoardWaitUser.MatchString(it.PauseWhy)) {
				continue
			}
			if !accepted && (strings.HasPrefix(it.Status, "等用户") || strings.HasPrefix(it.Status, "等待用户")) {
				continue
			}
			who := whoInWorkspace(*it)
			if who != e.name && who != e.DisplayName() {
				continue
			}
			if picked == nil || it.ID > picked.ID {
				picked = it
			}
			if boardID == it.ID {
				picked = it
				break
			}
		}
		if picked != nil {
			boardID, boardActive = picked.ID, true
			title = fmt.Sprintf("#%d %s", picked.ID, picked.What)
			if picked.parent != "" {
				chat = picked.parent
			}
		}
	}
	returned = returned || boardClosed
	if returned && !asking {
		e.scheduleWorkspaceReturn(key, time.Now())
	}
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if !since.IsZero() && !boardActive {
		for ws, rows := range st.Handoffs {
			if ws == key {
				continue
			}
			for _, h := range rows {
				if h.Chat == key && teamHandoffOpen(h) && !h.At.Before(since) {
					handedOff = true
				}
			}
		}
	}
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
	// Direct acceptance and board-owned active work have no handoff/d10
	// registration. Register unfinished work from this terminal event only.
	// A chat-channel 「已交给工作区」 acceptance is not work left in the chat channel.
	if (accepted || boardActive) && !returned && !handedOff && len(assignments) == 0 && e.team != nil {
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
		h := TeamHandoff{Chat: chat, At: now, Due: now.Add(watchCheckAfter()), Owner: owner, Title: shortLabel(title, teamTaskMaxRunes), Sender: sender, Board: boardID}
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
	delegated := e.watchDelegatedWork(key)
	for _, a := range assignments {
		h, ok := e.updateIdle(a, func(h *TeamHandoff) {
			h.Idle.Returned = returned
			h.Idle.Ended = time.Now()
			if worked {
				h.Idle.Wakes = 0
				h.Idle.Reported = false
			}
		})
		if ok && !returned && !delegated {
			a.h = h
			e.armIdleWake(a)
		}
	}
}

// watchHandoffLeft: a handoff item (it came from a chat, it.Chat) is no longer bound to
// workspace key. Asking the user (ws-up --ask) pauses the item and drops its workspace; the
// answer (ws-handoff --resume) clears the pause before the item is bound again, possibly to
// another workspace or only queued. The old workspace's watch must not wake it then: its
// session never got the answer and asks the user again (11-01 #855: answered at 03:22:32,
// the old workspace was told to carry on at 03:22:56 and posted the same [ask] at 03:23:11).
func watchHandoffLeft(it teamTaskBoardItem, key string) bool {
	if it.Chat == "" || chatOf(it.Chat) == key {
		return false
	}
	return it.WS == "" || teamChatKey(it.WS) != key
}

func (e *Engine) armIdleWake(a idleAssignment) {
	time.AfterFunc(watchTurnEndDelay, func() { e.fireIdleWake(a) })
}

func (e *Engine) fireIdleWake(a idleAssignment) {
	if e.ctx.Err() != nil || !e.quotaCooling().IsZero() || e.watchBusy(a.key) || e.watchDelegatedWork(a.key) {
		return
	}
	if e.team != nil {
		id := a.h.Board
		if id == 0 {
			id = watchTaskNumber(a.h.Title) // watches recorded before board IDs existed
		}
		if id != 0 {
			found, closed := false, false
			for _, it := range placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir)) {
				if it.ID == id {
					found = true
					// Handed to a workspace since: the workspace's watch keeps it, not this chat.
					closed = watchBoardClosed(it) || it.Paused != "" || it.own != a.key && it.parent == a.key && !it.wsEnded ||
						watchHandoffLeft(it, a.key)
					break
				}
			}
			if closed || !found && a.h.Board != 0 {
				e.updateIdle(a, func(h *TeamHandoff) { h.Idle.Returned = true })
				return
			}
		}
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
		who := watchMention(plat, h.Owner)
		if sender.watchOwns(p, h.Owner) {
			who = sender.DisplayName() // a lone bot does not mention itself
		}
		text := sender.i18n.Tf(MsgWatchIdleEscalate, who, h.Title)
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
	// A bot's own post cannot wake it, and a post mentioning itself only adds
	// noise: the sole bot wakes locally. When another bot posts the mention,
	// the platform supplies the normal user turn.
	if sender == e {
		e.wakeWatchRole(a.key, sender.i18n.Tf(MsgWatchResume, h.Title), h.Title)
	} else {
		text := strings.TrimSpace(watchMention(plat, owner) + " " + sender.i18n.Tf(MsgWatchResume, h.Title))
		if err := w.send(p, a.key, text); err != nil {
			slog.Warn("idle watch: wake post failed", "error", err)
		}
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
