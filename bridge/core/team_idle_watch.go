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

// watchCantDoRe: a turn that only says it cannot go on (blocked upstream, no access …). Two in a
// row stop the watch: resuming it again only produces the same refusal (11-05 agentm: woken every
// ten minutes, each time a long "做不了", and the tool calls of that reply counted as progress).
var watchCantDoRe = regexp.MustCompile(`(?i)做不了|做不到|干不了|办不到|没法做|没办法做|无法(?:完成|继续|推进|处理|执行)|卡在上游|\bcan(?:no|')t (?:do|proceed|continue|complete)\b|\bunable to (?:do|proceed|continue|complete)\b`)

func watchIsCantDo(text string) bool {
	return watchCantDoRe.MatchString(text)
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
	if kind, _, ok := parseExitKindTurn(text); ok && kind == exitKindReport {
		return true // a [report] after progress text is still the handback (#1270)
	}
	if strings.HasPrefix(text, "【接】") {
		return utf8.RuneCountInString(text) >= 300
	}
	// Length alone is not a handback (user 2026-10-28): a long progress note left the
	// handoff marked returned, so the watch skipped it and the workspace was never freed.
	return false
}

// watchHandbackLater: a reply whose first line is not the handback (「【接】…」, a mention) but a
// later line opens with [report] or 【交回】 still handed the work back, as far as the watch is
// concerned (#1183, 11-07: 龙娘 wrote 「【接】…」 then 「[report] #1162 …」 on the next line; the
// watch stayed open and woke her ten hours later). The exit forwarding still wants the marker on
// the first line; this only ends the watch.
func watchHandbackLater(text string) bool {
	_, rest, ok := strings.Cut(text, "\n")
	if !ok {
		return false
	}
	for _, line := range strings.Split(rest, "\n") {
		line = strings.TrimSpace(watchLeadingMentions.ReplaceAllString(strings.TrimSpace(StripMarkdown(line)), ""))
		if strings.HasPrefix(line, "[report]") || strings.HasPrefix(line, "【交回】") {
			return true
		}
	}
	return false
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

// watchAnsweredInChat: a 【接】 turn in a chat channel that names no board item and has no board
// item behind it was the whole answer (#221, 11-06: 大豆包「【接】\n一个最基础的登录页…」 and G哥
// 「【接】什么东西属于你…」 were one-line answers, yet each got two 「接着做」 wakes and an escalation).
// A chat channel hands real work to a workspace with ws-handoff, and that work is watched there
// under its board item; what was not handed off was answered in the chat. Running a tool does not
// change that (#1407, 11-10 agentm: 鲸鱼娘 ran `bothouse model list` to answer 「在+模型名」, the
// watch took the tool call for work in flight and woke her three times with 「还没交出去…交工作区」).
func watchAnsweredInChat(inWorkspace, boardActive bool, boardID int) bool {
	return !inWorkspace && !boardActive && boardID == 0
}

// watchBlankTitle: what is left of the first line after 【接】 cannot name the work: empty, or the
// 「-」 boardLabel gives an empty label (#221: 「接着做 -」). The body below may be the answer, so it
// is not used as a title either; a watched turn gets MsgWatchUntitledAccept instead.
func watchBlankTitle(title string) bool {
	return boardLabel(title) == "-"
}

// exitHeadlineBounced: a [report] naming a board item whose headline forwardWorkspaceExit bounces.
func (e *Engine) exitHeadlineBounced(key, body string) bool {
	id, _, _ := exitHeadline(body)
	return id > 0 && !e.exitHeadlineOK(body) && e.exitBounceCount(key) < exitRules.Bounce.WakeLimit
}

// watchBoardClosedWords: the closing words a board status may start with, the same set as
// board.py's CLOSED_RE (#497, user 2026-10-28 定过这五个词).
var watchBoardClosedWords = []string{"已验收", "验收通过", "已收口", "已完成", "已结束"}

// watchBoardClosedDone: board.py's CLOSED_RE also takes "done" but only as a whole word
// (\bdone\b), case-insensitively.
var watchBoardClosedDone = regexp.MustCompile(`(?i)^done\b`)

// watchBoardClosed: whether a board item is really finished. It must *start* with a closing word
// after leading spaces — the same prefix anchored test as board.py's CLOSED_RE (#497), not a
// substring anywhere in the status. 2026-11-09 the substring test read 「在做：脱敏实现…已完成，
// PR 已开」 as closed twice: the idle watch stopped watching and reconcileTeamWorkspaces freed the
// workspace at 15:07:04, killing the session (signal:killed at 15:07:05) while the author was
// still working. Statuses such as 「交回待验收」 or 「等待用户拍板」 never start with these words.
func watchBoardClosed(it teamTaskBoardItem) bool {
	status := strings.TrimSpace(it.Status)
	for _, word := range watchBoardClosedWords {
		if strings.HasPrefix(status, word) {
			return true
		}
	}
	return watchBoardClosedDone.MatchString(status)
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
	// A stale waiting-user card cannot turn a fresh acceptance into a handback.
	returned := cardResult && !accepted || watchIsHandback(text) || watchHandbackLater(text)
	// A validated user question waits for the user's answer, not an idle wake.
	asking := false
	// #1270: an [ask] after a progress line (parseExitKindTurn, as forwardWorkspaceExit reads it)
	// still waits for the user; it used to look like idle work and woke the workspace again.
	if kind, body, ok := parseExitKindTurn(text); ok && kind == exitKindAsk {
		returned = askEvidenceProblems(body) == nil
		asking = true
	} else if _, body, ok := parseExitKind(text); ok && returned && e.exitHeadlineBounced(key, body) {
		// A [report] bounced for its headline (forwardWorkspaceExit) is resent, not handed back yet.
		// Only a report that names a board item has a headline to repair: one without a #id cannot
		// satisfy the check however often it is resent, so there the reply stays a handback and its
		// watch ends instead of waking the workspace again for the same text (11-05 #96).
		returned = false
	}
	title := strings.TrimSpace(StripMarkdown(strings.TrimPrefix(first, "【接】")))
	boardID := watchTaskNumber(StripMarkdown(first))
	boardActive := false
	boardClosed := false
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
			if boardID == it.ID && watchBoardClosed(*it) {
				boardClosed = true
			}
			if boardID == it.ID && it.own != key && it.parent == key && !it.wsEnded {
				handedOff = true
			}
			// A chat channel hands work to workspaces; an item only on its board (handed back and
			// awaiting review, or the lead's own note) is not work left running there. Only an
			// explicit 【接】 is watched in a chat channel (#1167, 11-07: #1162 returned by 工作区2
			// fell back to the chat and got a 「接着做」 every lead turn).
			if !inWorkspace && !accepted ||
				it.own != key || it.wsEnded || it.Backlog != "" || watchBoardClosed(*it) ||
				it.Paused != "" && !(accepted && teamTaskBoardWaitUser.MatchString(it.PauseWhy)) {
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
	if (accepted || boardActive) && !returned && !handedOff && len(assignments) == 0 && e.team != nil &&
		!watchAnsweredInChat(inWorkspace, boardActive, boardID) {
		if !boardActive && watchBlankTitle(title) {
			title = e.i18n.T(MsgWatchUntitledAccept) // real work with a bare 【接】 is still watched (PR #1194 review)
		}
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
		giveUp, cantDo := false, false
		h, ok := e.updateIdle(a, func(h *TeamHandoff) {
			h.Idle.Returned = returned
			h.Idle.Ended = time.Now()
			if !returned && !asking && !failed && watchIsCantDo(text) {
				h.Idle.CantDo++
				if h.Idle.CantDo >= 2 && !h.Idle.Reported {
					h.Idle.Reported = true
					cantDo = true
					return
				}
			} else if !failed {
				h.Idle.CantDo = 0
			}
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
		if ok && cantDo {
			e.pauseCantDo(a.key, h, boardID)
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
						return // waits on someone else: no "carry on"; its next turn re-arms the watch
					}
					// Handed to a workspace since: the workspace's watch keeps it, not this chat.
					closed = watchBoardClosed(it) || it.Paused != "" || it.Backlog != "" || it.own != a.key && it.parent == a.key && !it.wsEnded ||
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

// pauseCantDo pauses the board item of an assignment that answered "can't do" twice in a row and
// tells a person once (the first admin_from id is mentioned). No role is woken: a wake would only
// start one more turn of the same refusal.
func (e *Engine) pauseCantDo(key string, h TeamHandoff, boardID int) {
	if h.Board != 0 {
		boardID = h.Board
	}
	if boardID != 0 {
		if out, err := e.runLeadScript(h.Chat, "board", "pause", strconv.Itoa(boardID), "连续两次回复做不了，看门自动暂停"); err != nil {
			slog.Warn("idle watch: cant-do pause failed", "board", boardID, "error", err, "output", strings.TrimSpace(string(out)))
		}
	}
	plat, _, _ := strings.Cut(key, ":")
	sender := e.watchSender(h)
	p := sender.lookupReadyPlatform(plat)
	if p == nil {
		slog.Warn("idle watch: sender platform unavailable", "workspace", key)
		return
	}
	human := ""
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	for _, id := range strings.Split(af, ",") {
		if id = strings.TrimSpace(id); id != "" && id != "*" {
			human = watchMention(plat, id) + " "
			break
		}
	}
	who := h.Owner
	if t := e.watchTarget(key, h.Owner); t != nil {
		who = t.DisplayName() // naming, not mentioning: a mention would start one more turn
	}
	text := sender.i18n.Tf(MsgWatchCantDoEscalate, human, who, h.Title)
	if err := newHandoffWatch(sender).send(p, h.Chat, text); err != nil {
		slog.Warn("idle watch: cant-do notice failed", "error", err)
	}
	slog.Info("idle watch: paused after two cant-do replies", "workspace", key, "board", boardID, "owner", h.Owner)
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
