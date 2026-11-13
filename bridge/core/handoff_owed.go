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
//   - 交出去的活有了结果: board items of the channel whose report was posted, is held for the lead, or that
//     were handed back after the old context's last entry, with when and in what state.

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

// handoffReturnedLines: board items shown in sessionKey's chat (open or finished) that, after since,
// had their report posted in the channel, are held for the lead's acceptance, or were handed back.
// One line each, 「#编号 短名 · 结果」; "" outside team mode or when nothing came back.
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
	items := placeTeamTaskBoard(e.teamTaskBoardPlacer(), append(readTeamTaskBoard(dir), readTeamTaskBoardFile(dir, teamTaskBoardDoneFile)...))
	seen := map[int]bool{}
	type row struct {
		at   time.Time
		line string
	}
	var rows []row
	for i := len(items) - 1; i >= 0; i-- { // board.jsonl first wins over an older board-done copy
		it := items[i]
		if seen[it.ID] || !it.shownIn(chat) {
			continue
		}
		seen[it.ID] = true
		var at time.Time
		state := ""
		if t, ok := reported[fmt.Sprint(it.ID)]; ok && t.After(since) {
			at, state = t, "汇报已贴进本频道"
		} else if e.reportHeldForLead(plat, it.ID) {
			// still waiting, however long ago it came back
			at, state = it.ReturnedAt, "交回了，等主角色验收，用户还没看到"
		} else if it.ReturnedAt.After(since) {
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
