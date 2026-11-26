package core

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

// Helpers only tests call. They were product code nothing reached
// (deadcode on darwin, linux and windows), so they live with the tests.

func (e *Engine) quotaCoolingUntil(msg string) (time.Time, bool) {
	return e.quotaCoolingUntilFor(e.quotaScopeFor(e.agent, modelOf(e.agent)), msg)
}

// withTurnBlocks puts the teammate status, wiki pages and handoff the
// agent's context does not hold yet before content. Called right before every
// send of a turn, so a message that never reaches the agent marks nothing as
// sent. The handoff goes with whatever turn comes first after a fresh start
// (user, cron, timer or queued); teammate status and wiki pages only with
// turnCtx messages.
func (e *Engine) withTurnBlocks(session *Session, sessionKey, query, content string, turnCtx bool) string {
	return e.withTurnBlocksRef(session, sessionKey, query, "", content, turnCtx, nil)
}

// teamBoardMembers renders the member lines and reports whether one of them shows live work
// (busy 🔧, or a task-card row 📋/⏳ still in work), from the same pick as the line.
func teamBoardMembers(files []teamFile, chat string, members []teamTaskMember) (string, bool) {
	lines := []string{"**谁在干啥**"}
	live := false
	now := time.Now()
	for _, f := range files {
		quotaNote := f.quotaDispatchNote(now)
		var best *teamEntry
		rank := 0
		for i := range f.Sessions {
			s := &f.Sessions[i]
			if !s.Worked {
				continue
			}
			r := 1 // recently done elsewhere: not worth showing
			switch {
			case s.Busy && chatOf(s.Key) == chat:
				r = 4
			case s.Busy:
				r = 3
			case chatOf(s.Key) == chat:
				r = 2
			}
			// Entries come from a map snapshot. Prefer the latest work within
			// the same rank so an older success cannot hide a newer failure.
			newer := false
			if best != nil {
				if s.Busy {
					newer = s.Since.After(best.Since)
				} else {
					newer = s.DoneAt.After(best.DoneAt)
				}
			}
			if r > rank || (r == rank && newer) {
				best, rank = s, r
			}
		}
		line := "💤 空闲"
		lineLive := rank == 4 // busy in another channel is not busy here
		if best != nil {
			task := boardTask(best.Task)
			switch rank {
			case 4:
				line = fmt.Sprintf("🔧 %s（%s 起）", task, best.Since.Local().Format("15:04"))
			case 3:
				// Busy in another channel: which one (a link), on what (user, 2026-10-26: 「谁在干啥卡
				// 关联其他频道角色情况」). Not 🔧: that icon means busy here (TeamBoardActive).
				// A DM: no task text (private) and no channel link (it would show as an unknown channel).
				if teamEntryIsDM(best) {
					line = fmt.Sprintf("↗️ 在私聊忙（%s 起）", best.Since.Local().Format("15:04"))
				} else {
					line = fmt.Sprintf("↗️ 在%s忙：%s（%s 起）", teamChatRef(best.Key, best.Chat), task, best.Since.Local().Format("15:04"))
				}
				if quotaNote == "" {
					line += teamElsewhereNote
				}
			case 2:
				switch best.Outcome {
				case teamWorkFailed:
					line = fmt.Sprintf("❌ %s（%s）", task, best.DoneAt.Local().Format("15:04"))
				case teamWorkUnconfirmed:
					line = fmt.Sprintf("⚠️ %s（%s）", task, best.DoneAt.Local().Format("15:04"))
				default:
					line = fmt.Sprintf("✅ 做完：%s（%s）", task, best.DoneAt.Local().Format("15:04"))
				}
			}
		}
		// A task-card assignment in this chat outranks being busy elsewhere
		// or idle; a live turn here still shows what is happening right now.
		if m := boardMember(f, members); m != nil && rank < 4 && (m.live() || rank < 2 || m.UpdatedAt.After(best.DoneAt)) {
			icon := "📋"
			lineLive = true
			switch m.Status {
			case "completed":
				icon, lineLive = "✅", false
			case "failed", "cancelled", "interrupted":
				icon, lineLive = "❌", false
			case "waiting":
				icon = "⏳"
			}
			status := teamMemberStatus[m.Status]
			if status == "" {
				status = taskIndexLabel(m.Status, 12)
			}
			line = fmt.Sprintf("%s %s（%s · %s）", icon, boardTask(taskIndexLabel(m.Title, teamBoardTaskRunes*2)), status, m.UpdatedAt.Local().Format("15:04"))
		}
		if quotaNote != "" {
			if line == "💤 空闲" {
				line = quotaNote
			} else {
				line += "；" + quotaNote
			}
		}
		lines = append(lines, fmt.Sprintf("**%s**　%s", f.Name, line))
		live = live || lineLive
	}
	return strings.Join(lines, "\n"), live
}

func (e *Engine) observeQuotaEvent(ev Event, session string, as AgentSession) {
	e.observeQuotaEventFor(ev, session, as, e.quotaScopeFor(e.agent, modelOf(e.agent)))
}

// waitQuotaUpdates blocks until every deferred updateQuotaState write is done.
func (e *Engine) waitQuotaUpdates() { e.quotaUpdates.Wait() }

func (e *Engine) recordQuotaFor(scope quotaScope, until time.Time, session string) {
	e.recordQuotaWindowFor(scope, until, session, "")
}

func splitMessage(text string, maxLen int) []string {
	runes := []rune(text)
	if len(runes) <= maxLen {
		return []string{text}
	}
	var chunks []string

	for len(runes) > 0 {
		if len(runes) <= maxLen {
			chunks = append(chunks, string(runes))
			break
		}

		end := maxLen

		// Try to split at newline boundary within the rune window.
		// Convert the candidate chunk back to a string for newline search.
		candidate := string(runes[:end])
		if idx := strings.LastIndex(candidate, "\n"); idx > 0 {
			// idx is a byte offset within candidate; convert to rune offset.
			runeIdx := utf8.RuneCountInString(candidate[:idx])
			if runeIdx >= end/2 {
				end = runeIdx + 1
			}
		}

		chunks = append(chunks, string(runes[:end]))
		runes = runes[end:]
	}
	return chunks
}

// queueMessageForBusySession queues a message for later delivery when the
// session is busy. The message is NOT sent to agent stdin at queue time;
// the event loop sends it after the current turn's EventResult is received.
// Returns true if the message was successfully queued, false otherwise.
func (e *Engine) queueMessageForBusySession(p Platform, msg *Message, interactiveKey string) bool {
	return e.enqueueForBusySession(p, msg, interactiveKey, nil) != queueUnavailable
}

// estimateTokens provides a rough token estimate for a set of history entries.
func estimateTokens(entries []HistoryEntry) int {
	return estimateTokensWithPendingAssistant(entries, "")
}

// runStart reports the card this turn may continue: its id and the sequence
// number that continuation would use. ok is false when the session has no open
// card, in which case the turn can only start one.
func (p *PublicProgress) runStart(token string) (taskID string, resumeSeq int64, ok bool) {
	taskID, resumeSeq, _, _, ok = p.resumeHint(token)
	return taskID, resumeSeq, ok
}

func (e *Engine) recordQuota(until time.Time, session string) {
	e.recordQuotaFor(e.quotaScopeFor(e.agent, modelOf(e.agent)), until, session)
}

// gateIsOurs: the gate on gateAddr serves dataDir (so it can be reused).
func gateIsOurs(dataDir string) bool { return sameDir(gateWhoami(), dataDir) }

func resetUpdateCheckCache() {
	updateCheckCache.Lock()
	updateCheckCache.at = time.Time{}
	updateCheckCache.Unlock()
}

func (e *Engine) memberOp(ctx context.Context, req MemberRequest) (MemberResponse, int) {
	return e.memberOpAs(ctx, req, nil)
}

// postExitOriginal copies body into the chat channel as 📬 posts (no lead took it). header
// overrides the first post's header (a headline's details). It returns the forwarded ask id.
func (e *Engine) postExitOriginal(ctx context.Context, p Platform, rc any, parent, ws, bot, kind, body, sessionKey, header string) string {
	id, _ := e.postExitOriginalErr(ctx, p, rc, parent, ws, bot, kind, body, sessionKey, header)
	return id
}

func (e *Engine) observeQuotaUsage(report *UsageReport, session string) {
	e.observeQuotaUsageFor(report, session, e.quotaScopeFor(e.agent, modelOf(e.agent)))
}

// renderTeamBoard renders one line per teammate for the board in chat. Times are wall-clock
// ("10:42 起") rather than elapsed, so the text only changes when someone's state changes.
// A teammate busy in another channel shows that channel (a link, teamChatRef) and its task.
func renderTeamBoard(files []teamFile, chat string) string {
	return renderTeamBoardMembers(files, chat, nil)
}

func scanDSHWebURL(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if m := dshWebURL.FindStringSubmatch(sc.Text()); m != nil {
			return m[1]
		}
	}
	return ""
}

// dshWebOwnDataDir: the data directory this bridge hands the hosts it starts — the value openDSHWeb
// passes (BOTHOUSE_DATA_DIR), the one the launchd unit passes (CC_DATA_DIR), or what both resolve
// from HOME when neither is set. One name is not enough: a host started by an older build, by the
// launchd unit or by hand may carry a different one of these than the bridge process itself.
func dshWebOwnDataDir() string {
	dirs := dshWebOwnDataDirs()
	if len(dirs) == 0 {
		return ""
	}
	return dirs[0]
}

// renderTeamTaskBoard renders a chat channel's task-board section, or "" when it has nothing
// there. It answers 「整体怎样、哪些等我」 — 卡住 and 等你 one item per line with their reason,
// 在做 on one line, paused items as a count. A workspace item is marked with its workspace's
// name. Items must be placed (placeTeamTaskBoard). Done items are not shown (user, 2026-10-28:
// 「完成的也没必要显示」).
func renderTeamTaskBoard(items []teamTaskBoardItem, chat string, now time.Time) string {
	backlog := teamTaskBoardBacklogLine(items, chat)
	items = teamTaskBoardDisplayItems(items, chat, now)
	rows := map[teamTaskBoardState][]string{}
	paused := 0
	for _, it := range items {
		if !it.shownIn(chat) {
			continue
		}
		state, note := teamTaskBoardStateOf(it, now)
		// Returned then paused: still listed (its handback is unreviewed work), but as paused.
		if state == teamTaskPaused && !it.wsEnded && it.ReturnedAt.IsZero() {
			paused++
			continue
		}
		if state == teamTaskHidden {
			continue
		}
		name := teamTaskBoardMarks[state] + " " + teamTaskBoardShort(it)
		if it.parent == chat && it.own != chat && it.wsName != "" {
			name += "（" + boardLabel(it.wsName) + "）"
		}
		if state != teamTaskRunning && note != "" {
			name += " · " + note
		}
		rows[state] = append(rows[state], name)
	}
	if len(rows) == 0 {
		return "" // only paused or 待办 items here: no board (paused items alone never kept one either)
	}
	lines := []string{"**任务板**"}
	for _, state := range []teamTaskBoardState{teamTaskStuck, teamTaskReview, teamTaskRelease, teamTaskRunning, teamTaskWaiting, teamTaskPaused} {
		r := rows[state]
		if len(r) == 0 {
			continue
		}
		head := fmt.Sprintf("**%s %d**", teamTaskBoardNames[state], len(r))
		if state == teamTaskRunning {
			lines = append(lines, head+"  "+strings.Join(r, "  "))
			continue
		}
		lines = append(lines, head)
		lines = append(lines, r...)
	}
	if paused > 0 {
		lines = append(lines, fmt.Sprintf("暂停 %d 件（已收起）", paused))
	}
	if backlog != "" {
		lines = append(lines, backlog)
	}
	return strings.Join(lines, "\n")
}

// needsDoneReaction returns true if the preview was delivered via in-place
// UpdateMessage at least once, meaning the user only received a push for the
// initial SendPreviewStart and subsequent updates were silent. In this case a
// "done" reaction can notify the user that processing has completed.
func (sp *streamPreview) needsDoneReaction() bool {
	sp.mu.Lock()
	defer sp.mu.Unlock()
	return sp.previewMsgID != nil && sp.lastSentViaUpdate
}

func renderTeamBoardWithTasks(files []teamFile, chat string, lang Language) string {
	text, _ := teamBoardWithTasks(files, chat, lang)
	return text
}

// chatClock: 「15:04」 today, 「明天 15:04」 tomorrow, else 「01-02 15:04」.
func chatClock(t, now time.Time) string {
	t = t.In(now.Location())
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	switch {
	case !t.Before(today) && t.Before(today.AddDate(0, 0, 1)):
		return t.Format("15:04")
	case !t.Before(today.AddDate(0, 0, 1)) && t.Before(today.AddDate(0, 0, 2)):
		return "明天 " + t.Format("15:04")
	}
	return t.Format("01-02 15:04")
}

// rememberReport records a queued handback wake. false: an equal report is still pending or was
// just delivered, so the caller must not queue another wake, or the record could not be saved.
func (e *Engine) rememberReport(rec *pendingReport) bool {
	ok, _ := e.rememberReportErr(rec)
	return ok
}

// reportSeenRecently reports whether this handback is still pending or was delivered within the
// dedupe window; true means no second wake/post for the same words.
func (e *Engine) reportSeenRecently(key string) bool {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	if rec := e.loadReportsLocked()[key]; rec != nil {
		if !rec.delivered() || time.Since(rec.DeliveredAt) <= teamReportDedupe {
			return true
		}
		delete(e.teamExit.reports, key)
		e.saveReportsLocked()
	}
	return false
}

// withAssignerMention puts the platform mention of item's assigner (assignerUser) at the start of
// text; text unchanged when there is no one to notify.
func (e *Engine) withAssignerMention(p Platform, item *teamTaskBoardItem, text string) string {
	if p == nil {
		return text
	}
	if m := watchMention(p.Name(), e.assignerUser(p, item)); m != "" {
		return m + " " + text
	}
	return text
}

// renderTeamTaskBoardFit: renderTeamTaskBoard cut by whole lines to budget runes. Running items
// are never dropped (board.py card_text): the section keeps at least its lines up to the 在做 line,
// so a long board above it is cut instead (withTeamTaskBoard).
func renderTeamTaskBoardFit(items []teamTaskBoardItem, chat string, now time.Time, budget int) string {
	s := renderTeamTaskBoard(items, chat, now)
	lines := strings.Split(s, "\n")
	running := "**" + teamTaskBoardNames[teamTaskRunning] + " "
	for k, ln := range lines {
		if strings.HasPrefix(ln, running) {
			keep := len([]rune(strings.Join(lines[:k+1], "\n"))) + 1 + len([]rune(fmt.Sprintf("…还有 %d 件放不下", len(lines))))
			budget = max(budget, keep)
			break
		}
	}
	return cutTeamBoardLines(s, budget, "")
}

// teamTaskBoardWaitHours: whole hours a paused item has waited on the user, 0 below one hour or
// when it does not wait on the user. Paused is "MM-DD HH:MM" local without a year: this year,
// or last year when that is more than a day ahead (board.py _done_time).
func teamTaskBoardWaitHours(it teamTaskBoardItem, now time.Time) int {
	if !it.waitsUser() {
		return 0
	}
	at, ok := teamTaskBoardLocal(it.Paused, now)
	if !ok {
		return 0
	}
	return int(now.Sub(at) / time.Hour)
}

// taskReviewTierModel: the model reviewer runs it on; only the tier's own role, since a model ID
// belongs to that role's agent.
func taskReviewTierModel(it teamTaskBoardItem, reviewer string) string {
	m := teamReviewModels.Load()
	if m == nil || reviewer == "" || reviewer != taskReviewTierRole(it) {
		return ""
	}
	if taskReviewComplex(it) {
		return m[1]
	}
	return m[0]
}

func boardTask(task string) string {
	if task == "" {
		return "处理中"
	}
	if r := []rune(task); len(r) > teamBoardTaskRunes {
		return string(r[:teamBoardTaskRunes]) + "…"
	}
	return task
}

// teamEntryIsDM: the session is a direct message. A DM channel has no name, so the platform's
// ChatName is empty or falls back to the channel id (Discord ResolveChannelName).
func teamEntryIsDM(s *teamEntry) bool {
	name := strings.TrimSpace(s.Chat)
	if name == "" {
		return true
	}
	_, id, _ := strings.Cut(chatOf(s.Key), ":")
	return id != "" && name == id
}

// boardMember picks the teammate's task-card row in this chat: live rows
// first, then the latest progress. Native children share their owner's bot
// account and are not roster entries.
func boardMember(f teamFile, members []teamTaskMember) *teamTaskMember {
	var best *teamTaskMember
	for i := range members {
		m := &members[i]
		if m.ParentID != "" {
			continue
		}
		if m.ReporterProject != "" {
			if m.ReporterProject != f.Project {
				continue
			}
		} else if m.Name == "" || m.Name != f.Name {
			continue
		}
		if best == nil || (m.live() && !best.live()) || (m.live() == best.live() && m.UpdatedAt.After(best.UpdatedAt)) {
			best = m
		}
	}
	return best
}

func (m *teamTaskMember) live() bool {
	return m.Status == "queued" || m.Status == "running" || m.Status == "waiting"
}

func renderTeamBoardMembers(files []teamFile, chat string, members []teamTaskMember) string {
	text, _ := teamBoardMembers(files, chat, members)
	return text
}

// teamBoardWithTasks is renderTeamBoardWithTasks and whether it shows live work: a member line
// in work (teamBoardMembers) or a task card in the index (only running / waiting are listed).
func teamBoardWithTasks(files []teamFile, chat string, lang Language) (string, bool) {
	var members []teamTaskMember
	for _, f := range files {
		for _, task := range f.Tasks {
			if chatOf(task.SessionKey) == chat && listedTaskState(task.State) && boardTaskURL(task.URL) {
				members = append(members, task.Members...)
			}
		}
	}
	board, live := teamBoardMembers(files, chat, members)
	index, indexLive := renderTeamTaskIndex(files, chat, lang)
	if index != "" {
		board = strings.TrimRight(board, "\n") + "\n\n" + index
	}
	return board, live || indexLive
}

func lookupWakeReturn(id string) (wakeReturn, bool) {
	wakeReturns.mu.Lock()
	defer wakeReturns.mu.Unlock()
	w := wakeReturns.byID[id]
	if w == nil {
		return wakeReturn{}, false
	}
	return *w, true
}
