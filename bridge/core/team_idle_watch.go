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
)

// Idle wakeups are armed by terminal events, never by the periodic progress scan.
// Fifteen seconds lets the completed turn unlock and queued work start first.
const watchTurnEndDelay = 15 * time.Second

// Turns of one watched assignment that may end in an agent error in a row before
// the watch stops resuming it and asks the primary role to reassign (user 2026-11-01:
// four upstream errors each followed by another automatic resume).
const watchFailLimit = 2

type watchIdleState struct {
	Returned bool      `json:"returned,omitempty"`
	Ended    time.Time `json:"ended,omitzero"`
	Wakes    int       `json:"wakes,omitempty"`
	Fails    int       `json:"fails,omitempty"`   // consecutive turns that ended in an agent error
	CantDo   int       `json:"cant_do,omitempty"` // consecutive turns that answered "can't do it"
	Reported bool      `json:"reported,omitempty"`
}

// watchBoardWaiting: a board status that says the item waits on someone else (等上游, 等待…, 等用户):
// the watch does not tell its owner to carry on.
func watchBoardWaiting(status string) bool {
	return strings.HasPrefix(strings.TrimSpace(status), "等")
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

// watchOwnerIsPerson: owner is a person, not a bot (a claim that named the user who asked for
// the task). The watch talks only to the roles working a task: a person is never mentioned to
// hand back or carry on, and their posts are not the task's progress. A person is an admin_from
// id, or an author whose posts in chat (or the workspace) are not a bot's; a role of this bridge
// and an id never seen there count as bots (the mention stays as before).
func (e *Engine) watchOwnerIsPerson(plat, chat, owner string) bool {
	id := watchOwnerID(owner)
	if id == "" || e.watchTarget(plat+":", owner) != nil {
		return false
	}
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	for _, a := range strings.Split(af, ",") {
		if strings.TrimSpace(a) == id {
			return true
		}
	}
	r, ok := e.lookupReadyPlatform(plat).(ChannelHistoryReader)
	if !ok {
		return false
	}
	msgs, err := r.ChannelHistory(teamChannelID(chat), "", watchHistoryLimit)
	if err != nil {
		return false
	}
	for _, m := range msgs {
		if m.AuthorID == id {
			return !m.IsBot
		}
	}
	return false
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

// watchBusy: a turn is running in chat key (the turn fact, #699 B). One answer for the watch, the
// idle wake, the auto return and the release hold; before, this scanned the workspace pool's
// session tables and the watch's workspaceBusy did not, and the two disagreed (#698 15:42).
func (e *Engine) watchBusy(key string) bool { return teamTurnRunning(key) }

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
	st, err := loadTeamWorkspacesLocked(path)
	if err != nil {
		slog.Error("team idle watch: workspace state unreadable", "workspace", a.key, "error", err)
		return TeamHandoff{}, false
	}
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
func watchTaskNumber(text string) int {
	m := watchTaskNumberRE.FindStringSubmatch(strings.TrimPrefix(text, "【接】"))
	if m == nil {
		return 0
	}
	id, _ := strconv.Atoi(m[1])
	return id
}

// watchStale: a watch whose board item or owner cannot be told is closed once its due time has
// passed, instead of being kept for later wakes (#1183, 11-07: a numberless watch from 09:13 woke
// 龙娘 at 19:03; 鲸鱼娘's follow-up, relayed by the lead: 「认不出任务编号或负责人的看门，过了 due
// 就直接按过期关」). Checked when a turn ends and again right before a wake is sent. A watch with a
// board item is judged by the board instead (fireIdleWake).
func watchStale(h TeamHandoff, key string, items []teamTaskBoardItem, now time.Time) bool {
	if h.Due.IsZero() || !now.After(h.Due) {
		return false
	}
	return strings.TrimSpace(h.Owner) == "" || h.Board == 0 && handoffBoardID(key, h, items) == 0
}

// watchTurnEnded runs before finishPublicProgress: automatic card completion is
// not a deliberate result. A report, handback or explicit result ends the watch.
// since: when the turn began (zero when unknown); a workspace handoff recorded from this chat
// after it means the accepted work now belongs to that workspace.
// scheduled: the turn is a cron/timer/heartbeat routine (state.turnScheduled, set by
// scheduledTurnUser in public_progress_auto.go). Such a turn's failure is the routine's own
// timeout or error, not the watched work's: 2026-11-06 05:22:09 and 05:55:34 the main bridge
// stopped two scheduled turns after 30m (heartbeat:discord:1560508467733860372 and a review
// timer) and the watch counted both as #170's 「连续两次报错」 — it stopped resuming that board
// item and asked the primary role to reassign it, though #170 itself never failed. So the
// failure count stays untouched for those turns; handback, registration and wake-ups are not
// affected.
func (e *Engine) watchTurnEnded(p Platform, key, text string, worked, failed, scheduled, cardResult bool, since time.Time) {
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
	// #699 C: handed back, asking or failed is the task's state (WorkspaceExit from ws-up --report,
	// the park of ws-up --ask, board.py through the bridge), never a marker in the reply text: the
	// [report]/【交回】/PR-link/【接】≥300 guesses and the 「做不了」 pattern are gone (design §4 rows 1–2).
	// A stale waiting-user card cannot turn a fresh acceptance into a handback.
	returned := cardResult && !accepted
	switch e.workspaceTaskStateAt(key) {
	case TeamTaskReturned, TeamTaskFailed, TeamTaskClosed:
		returned = true
	case TeamTaskAsking, TeamTaskPaused:
		returned = true
	}
	title := strings.TrimSpace(StripMarkdown(strings.TrimPrefix(first, "【接】")))
	boardID := watchTaskNumber(StripMarkdown(first))
	boardActive := false
	handedOff := false // the accepted work is in a workspace: its watch is the workspace's
	chat := key
	parent, inWorkspace := e.WorkspaceParent(key)
	if inWorkspace {
		chat = parent
	}
	var items []teamTaskBoardItem
	if e.team != nil {
		items = placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir))
		var picked *teamTaskBoardItem
		for i := range items {
			it := &items[i]
			if boardID != 0 && boardID != it.ID {
				continue
			}
			if boardID == it.ID && it.own != key && it.parent == key && !it.wsEnded {
				handedOff = true
			}
			// A chat channel hands work to workspaces; an item only on its board (handed back and
			// awaiting review, or the lead's own note) is not work left running there. Only an
			// explicit 【接】 is watched in a chat channel (#1167, 11-07: #1162 returned by 工作区2
			// fell back to the chat and got a 「接着做」 every lead turn).
			if !inWorkspace && !accepted ||
				it.own != key || it.wsEnded || it.Backlog != "" ||
				it.Paused != "" && !(accepted && it.waitsUser()) {
				continue
			}
			if !accepted && watchBoardWaiting(it.Status) {
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
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if err != nil {
		teamWorkspaceStore.mu.Unlock()
		slog.Error("team watch: workspace state unreadable at turn end", "workspace", key, "error", err)
		return
	}
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
	staleClosed := false
	for _, script := range []bool{false, true} {
		rows := st.Handoffs[key]
		if script {
			rows = st.ScriptWatches[key]
		}
		for i, h := range rows {
			if teamHandoffOpen(h) && !h.Idle.Returned && !h.Due.IsZero() && e.watchOwns(p, h.Owner) {
				if script && watchStale(h, key, items, time.Now()) {
					rows[i].Closed = time.Now()
					staleClosed = true
					slog.Info("idle watch: closed a stale watch with no board item", "workspace", key, "owner", h.Owner, "title", h.Title, "at", h.At)
					continue
				}
				assignments = append(assignments, idleAssignment{key, h, script})
			}
		}
	}
	if staleClosed {
		if err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), st); err != nil {
			slog.Error("idle watch: close stale watch failed", "workspace", key, "error", err)
		}
	}
	// Direct acceptance and board-owned active work have no handoff/d10
	// registration. Register unfinished work from this terminal event only.
	// A chat-channel 「已交给工作区」 acceptance is not work left in the chat channel.
	// Only board-owned work in a workspace with no handoff registration is registered here; a 【接】
	// in a chat channel is not watched (design §7.3; #699 C/E).
	if inWorkspace && boardActive && !returned && !handedOff && len(assignments) == 0 && e.team != nil {
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
		if !returned && e.boardReleaseHeld(a.key, a.h) {
			// Saved for a central release: an interrupted or failed turn is not a failure, and the
			// next process wakes it (resumeReleaseHolds). The count starts afresh, so a release
			// called off (board unhold) does not escalate on its first error; the recheck keeps
			// the watch armed for that case (#984 review).
			h, ok := e.updateIdle(a, func(h *TeamHandoff) {
				h.Idle.Fails, h.Idle.Wakes, h.Idle.Reported = 0, 0, false
				h.Idle.Ended = time.Now()
			})
			if ok {
				a.h = h
				e.armReleaseHoldRecheck(a)
			}
			continue
		}
		giveUp := false
		h, ok := e.updateIdle(a, func(h *TeamHandoff) {
			h.Idle.Returned = returned
			h.Idle.Ended = time.Now()
			if failed && scheduled {
				return // the routine's own failure counts toward nothing here (see watchTurnEnded)
			}
			if failed {
				// Tools run before an error are not progress: keep the wake count.
				h.Idle.Fails++
				if !returned && h.Idle.Fails >= watchFailLimit && !h.Idle.Reported {
					h.Idle.Reported = true
					giveUp = true
				}
				return
			}
			h.Idle.Fails = 0
			if worked && !h.Idle.Reported {
				// Work in progress clears the wake count. A watch that already reported (two
				// unanswered wakes, or the failure limit above) is not restarted by a later turn
				// that happened to run tools: it stays reported, and only its handback closes it
				// (11-05 #96: clearing it let the same assignment wake and escalate forever).
				h.Idle.Wakes = 0
			}
		})
		if ok && giveUp {
			if e.reassignFailedWork(a, h) {
				continue
			}
			e.escalateIdle(a.key, h, MsgWatchFailEscalate)
			continue
		}
		if ok && !returned && !delegated && !h.Idle.Reported {
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

// armReleaseHoldRecheck: while held for a release the watch looks again every ten-minute check
// (沿用 watchCheckAfter); once the hold is gone (board unhold) fireIdleWake carries on as usual.
func (e *Engine) armReleaseHoldRecheck(a idleAssignment) {
	time.AfterFunc(watchCheckAfter(), func() { e.fireIdleWake(a) })
}

func (e *Engine) fireIdleWake(a idleAssignment) {
	if e.ctx.Err() != nil || !e.quotaCoolingFor(e.admissionQuotaScope(e.agent, a.key)).IsZero() || e.watchBusy(a.key) || e.watchDelegatedWork(a.key) {
		return
	}
	if e.team != nil {
		items := placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir))
		if id := handoffBoardID(a.key, a.h, items); id != 0 {
			found, closed := false, false
			for _, it := range items {
				if it.ID == id {
					found = true
					if activeReleaseHold(it) {
						// Saved for a release: the next process resumes it (resumeReleaseHolds).
						// Look again later, starting afresh, in case the release is called off.
						if h, ok := e.updateIdle(a, func(h *TeamHandoff) {
							h.Idle.Fails, h.Idle.Wakes, h.Idle.Reported = 0, 0, false
						}); ok {
							a.h = h
							e.armReleaseHoldRecheck(a)
						}
						return
					}
					if watchBoardWaiting(it.Status) {
						// #1492: in a workspace a 「等…」 written with `board update` is text, not a state
						// (#699 D). Waiting on the user goes through ws-up --ask (the item pauses), on
						// something outside through 等外部 (it parks); a bare 「等用户确认」 asked no one,
						// and the watch went quiet for good. A chat channel's own note still waits.
						if _, inWS := e.WorkspaceParent(a.key); !inWS {
							return // waits on someone else: no "carry on"; its next turn re-arms the watch
						}
					}
					// Handed to a workspace since: the workspace's watch keeps it, not this chat.
					closed = it.Paused != "" || it.Backlog != "" || it.own != a.key && it.parent == a.key && !it.wsEnded ||
						watchHandoffLeft(it, a.key)
					break
				}
			}
			if closed || !found && a.h.Board != 0 {
				e.updateIdle(a, func(h *TeamHandoff) { h.Idle.Returned = true })
				return
			}
		}
		if a.script && watchStale(a.h, a.key, items, time.Now()) {
			e.updateIdle(a, func(h *TeamHandoff) { h.Closed = time.Now() })
			slog.Info("idle watch: closed a stale watch with no board item", "workspace", a.key, "owner", a.h.Owner, "title", a.h.Title, "at", a.h.At)
			return
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
	if escalate {
		e.escalateIdle(a.key, h, MsgWatchIdleEscalate)
		return
	}
	e.sendIdleWake(a, h)
}

// sendIdleWake asks the owner of a's handoff to carry on, then arms the next idle check.
func (e *Engine) sendIdleWake(a idleAssignment, h TeamHandoff) bool {
	plat, _, _ := strings.Cut(a.key, ":")
	sender := e.watchSender(h)
	p := sender.lookupReadyPlatform(plat)
	if p == nil {
		slog.Warn("idle watch: sender platform unavailable", "workspace", a.key)
		return false
	}
	w := newHandoffWatch(sender)
	owner := h.Owner
	if m, ok := e.lookupReadyPlatform(plat).(SelfMentioner); ok && m.SelfMention() != "" {
		owner = m.SelfMention()
	}
	// A bot's own post cannot wake it, and a post mentioning itself only adds
	// noise: the sole bot wakes locally. When another bot posts the mention,
	// the platform supplies the normal user turn.
	msg := MsgWatchResume
	if _, inWorkspace := e.WorkspaceParent(a.key); !inWorkspace {
		msg = MsgWatchChatHandoff // a chat channel's work goes to a workspace, not finished in the chat
	}
	if sender == e {
		e.wakeWatchRole(a.key, sender.i18n.Tf(msg, h.Title), h.Title)
	} else {
		text := strings.TrimSpace(watchMention(plat, owner) + " " + sender.i18n.Tf(msg, h.Title))
		if err := w.send(p, a.key, text); err != nil {
			slog.Warn("idle watch: wake post failed", "error", err)
		}
	}
	a.h = h
	e.armIdleWake(a) // two wake attempts, then one escalation; not a polling loop
	return true
}

func (e *Engine) watchSender(h TeamHandoff) *Engine {
	for _, x := range e.watchEngines() {
		if (h.Sender != "" && x.name == h.Sender) || (h.Sender == "" && x.isTeamLead()) {
			return x
		}
	}
	return e
}

// escalateIdle stops resuming the assignment: it tells the chat once and wakes the
// primary role there to take over or reassign.
func (e *Engine) escalateIdle(key string, h TeamHandoff, msg MsgKey) {
	plat, _, _ := strings.Cut(key, ":")
	sender := e.watchSender(h)
	p := sender.lookupReadyPlatform(plat)
	if p == nil {
		slog.Warn("idle watch: sender platform unavailable", "workspace", key)
		return
	}
	who := watchMention(plat, h.Owner)
	if sender.watchOwns(p, h.Owner) || e.watchOwnerIsPerson(plat, h.Chat, h.Owner) {
		who = sender.DisplayName() // a lone bot does not mention itself; a person is never mentioned
	} else if msg == MsgWatchFailEscalate {
		// Naming, not mentioning: a mention would start one more failing turn.
		if t := e.watchTarget(key, h.Owner); t != nil {
			who = t.DisplayName()
		}
	}
	text := sender.i18n.Tf(msg, who, h.Title)
	if err := newHandoffWatch(sender).send(p, h.Chat, text); err != nil {
		slog.Warn("idle watch: escalation failed", "error", err)
	}
	sender.wakeWatchRole(h.Chat, text, h.Title)
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
	st, err := loadTeamWorkspacesLocked(path)
	if err != nil {
		teamWorkspaceStore.mu.Unlock()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
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
		// since is whole seconds; a watch registered by the bridge itself keeps sub-second time,
		// so an exact Equal never matched it and close answered "not registered" (2026-11-01).
		if h.Owner == req.Owner && h.Sender == req.Project && h.At.Unix() == at.Unix() {
			found = h
		}
	}
	if found == nil && req.Action == "close" {
		// Stopping an assignment must not depend on the caller knowing its start second:
		// close every open watch of this role from this sender in the channel.
		for i := range st.ScriptWatches[key] {
			if h := &st.ScriptWatches[key][i]; h.Owner == req.Owner && h.Sender == req.Project && h.Closed.IsZero() {
				h.Closed = time.Now()
				found = h
			}
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
	err = saveTeamWorkspacesLocked(path, st)
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
