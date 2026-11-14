package core

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// What a swapped-out context still owes, or what came back for it, read from the bridge's records and
// never from text (user 11-14 「2 4有点问题 找根因修一下」, #758). Before this the handoff's only account of
// open work besides the board was the minutes' 「没做完/卡住的」 column, which a cheap model guessed from
// 200-rune chat snippets: on 11-14 00:17 it turned a disclosed 「还有两件我没核」 into a pending to-do and
// said #755's result 「还没转告用户」 although it had been posted in the channel at 23:19.
//
// Two lists, both from records:
//   - 已排的定时: this bot's timers on the channel not yet fired. A promise's receipt is a timer
//     (promise-guard), keyed by the chat, so it outlives the context; the new one is told it is there.
//   - 交出去的活有了结果: board items of the channel whose current round's report is held for the lead,
//     was posted, or that were handed back after the old context's last entry, with when and in what state.

// handoffOwed renders both lists as handoff sections ("" when neither has a line).
func (e *Engine) handoffOwed(sessionKey string, h *SessionHandoff) string {
	if sessionKey == "" {
		return ""
	}
	var b strings.Builder
	if t := e.handoffTimerLines(sessionKey); t != "" {
		b.WriteString("\n## 已排的定时（答应过的回访，到点桥自动叫你，不用再记）\n" + t + "\n")
	}
	if r := e.handoffReturnedLines(sessionKey, handoffLastAt(h)); r != "" {
		b.WriteString("\n## 本频道交出去的活，旧会话停下后有了结果（按记录，不是猜的）\n" + r + "\n")
	}
	return b.String()
}

// handoffLastAt: the old context's last entry (zero when none has a time).
func handoffLastAt(h *SessionHandoff) time.Time {
	var last time.Time
	if h == nil {
		return last
	}
	for _, t := range h.Tail {
		if t.Timestamp.After(last) {
			last = t.Timestamp
		}
	}
	return last
}

// handoffTimerLines: this bot's unfired timers on sessionKey's chat, soonest first, one per line
// 「MM-DD HH:MM 描述」, cut by whole lines to the handoff's tail budget like the task list.
func (e *Engine) handoffTimerLines(sessionKey string) string {
	if e.timerScheduler == nil {
		return ""
	}
	st := e.timerScheduler.Store()
	if st == nil {
		return ""
	}
	chat := teamChatKey(sessionKey)
	var jobs []*TimerJob
	for _, j := range st.List() {
		if j == nil || j.Fired || j.Project != e.name || teamChatKey(j.SessionKey) != chat {
			continue
		}
		jobs = append(jobs, j)
	}
	if len(jobs) == 0 {
		return ""
	}
	sort.Slice(jobs, func(a, b int) bool { return jobs[a].ScheduledAt.Before(jobs[b].ScheduledAt) })
	var lines []string
	for _, j := range jobs {
		what := oneLine(j.Description)
		if what == "" {
			what = oneLine(j.Prompt)
		}
		if what == "" {
			what = oneLine(j.Exec)
		}
		lines = append(lines, stamp(j.ScheduledAt)+" "+clipRunes(what, handoffEntryRunes, false))
	}
	return cutTeamBoardLines(strings.Join(lines, "\n"), handoffTailRunes, "")
}

// handoffReturnedLines: board items shown in sessionKey's chat (open or finished) whose current round —
// the handoff they are bound to now (Bound, as exitReportedForHandoff in team_exit_headline.go) — after
// since has a report held for the lead, had its report posted in the channel, or was handed back.
// One line each, 「#编号 短名 · 结果」; "" outside team mode or when nothing came back. An item sent
// back for rework and not yet returned has no line: its earlier round's post is not this round's.
func (e *Engine) handoffReturnedLines(sessionKey string, since time.Time) string {
	dir := e.teamStatusDir()
	if dir == "" || since.IsZero() {
		return ""
	}
	chat := teamChatKey(sessionKey)
	plat, _, _ := strings.Cut(chat, ":")
	e.teamExit.mu.Lock()
	reported := e.readExitReported()
	e.teamExit.mu.Unlock()
	// placed like the board (handoffTaskLines), so shownIn knows each item's chat and its parent
	items := placeTeamTaskBoard(e.teamTaskBoardPlacer(), currentTeamTaskBoardItems(dir))
	type row struct {
		at   time.Time
		line string
	}
	var rows []row
	for _, it := range items {
		if !it.shownIn(chat) {
			continue
		}
		bound, err := time.Parse(time.RFC3339Nano, it.Bound)
		inRound := func(t time.Time) bool { return t.After(since) && (err != nil || !t.Before(bound)) }
		var at time.Time
		state := ""
		if held := e.heldReportThisRound(plat, it); held != nil {
			// still waiting, however long ago it came back
			at, state = held.CreatedAt, "交回了，等主角色验收，用户还没看到"
		} else if t, ok := reported[fmt.Sprint(it.ID)]; ok && inRound(t) {
			at, state = t, "汇报已贴进本频道"
		} else if inRound(it.ReturnedAt) {
			at, state = it.ReturnedAt, "交回了"
		}
		if state == "" {
			continue
		}
		rows = append(rows, row{at, fmt.Sprintf("#%d %s · %s %s", it.ID, teamTaskBoardShort(it), stamp(at), state)})
	}
	if len(rows) == 0 {
		return ""
	}
	sort.Slice(rows, func(a, b int) bool { return rows[a].at.Before(rows[b].at) })
	lines := make([]string, len(rows))
	for i, r := range rows {
		lines[i] = r.line
	}
	return cutTeamBoardLines(strings.Join(lines, "\n"), handoffTailRunes, "")
}

// currentTeamTaskBoardItems: one record per board item, its current one. An item on board.jsonl is
// open now (reopened for rework, say) and wins over any copy in board-done.jsonl; among done copies
// the last line, the newest close, wins.
func currentTeamTaskBoardItems(dir string) []teamTaskBoardItem {
	items := readTeamTaskBoard(dir)
	have := make(map[int]bool, len(items))
	for _, it := range items {
		have[it.ID] = true
	}
	done := readTeamTaskBoardFile(dir, teamTaskBoardDoneFile)
	var older []teamTaskBoardItem
	for i := len(done) - 1; i >= 0; i-- {
		if !have[done[i].ID] {
			have[done[i].ID] = true
			older = append(older, done[i])
		}
	}
	return append(items, older...)
}

// heldReportThisRound: the report held for the lead of platform for board item it, when it belongs
// to the item's current handoff (a hold made under another bind is an earlier round's).
func (e *Engine) heldReportThisRound(platform string, it teamTaskBoardItem) *pendingReport {
	owner := e
	if lead := e.reportLead(platform); lead != nil {
		owner = lead
	}
	rec := owner.heldReportFor(it.ID)
	if rec == nil || rec.HeldBound != "" && it.Bound != "" && rec.HeldBound != it.Bound {
		return nil
	}
	return rec
}
