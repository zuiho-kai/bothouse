package core

import (
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Waiting on something outside (user 11-09「没卡导致不断重复跑，符合预期么」, then「修」to: 外部卡住时检查放行、
// 贴回频道、标「等外部」，进度检查和兜底提醒不再叫醒，只按约好时间回来看). agentm #26: eight GPUs were all
// taken; the workspace said so in its [report], the intent check bounced it as 「没测用户点名的东西」, and the
// bounces, the 30-minute guard timer and the 10-minute watch kept waking it — one turn ran 16 minutes on 390k
// input tokens, to say the same thing again.
//
// A [report] with a line 「等外部：<卡在什么>」 (optionally 「再看：2h」) is a report that the task is blocked
// outside. It skips the intent check (it cannot test what it cannot get), is held for the lead and posted like
// any report, and then, instead of 「已交回待验收」, the board item is paused as 「等外部：…」 with wait_until
// (board.py wait): the workspace is freed, the guard timer is dropped, and nothing watches it. When
// wait_until comes, the watch loop hands it to a free workspace again (ws-handoff --resume), which first checks
// whether the condition is met.

const (
	waitExternalWhy = "等外部："
	// waitExternalDefault: retry time when the report names none. Source: 橘 1283 — the guard timer was
	// 30 minutes and woke the workspace for nothing; an hour is one hourly 收口.
	waitExternalDefault = time.Hour
	waitExternalMin     = 10 * time.Minute // the watch's own cadence (watchCheckAfterDefault)
	waitExternalMax     = 24 * time.Hour   // board auto-prune's idle threshold (board.py PRUNE_IDLE_DEFAULT_H)
	// waitExternalRetryGap: a failed resume (no free workspace script, bridge busy) is tried again after this.
	waitExternalRetryGap = 10 * time.Minute
)

var (
	waitExternalLine = regexp.MustCompile(`(?m)^[\s>*\-【\[]*等外部[】\]]?\s*[：:]\s*(.+?)\s*$`)
	waitAgainLine    = regexp.MustCompile(`(?m)^[\s>*\-【\[]*再看[】\]]?\s*[：:]\s*(.+?)\s*$`)
	waitDuration     = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(h|小时|个小时|m|min|分钟|分)`)
)

// waitExternalOf finds the 「等外部：」 line of a [report] body: what blocks it, and when to look again.
func waitExternalOf(body string) (why string, after time.Duration, ok bool) {
	m := waitExternalLine.FindStringSubmatch(body)
	if m == nil {
		return "", 0, false
	}
	why = strings.TrimSpace(m[1])
	if why == "" || why == "无" || why == "没有" {
		return "", 0, false
	}
	after = waitExternalDefault
	if a := waitAgainLine.FindStringSubmatch(body); a != nil {
		if d, ok := parseWaitDuration(a[1]); ok {
			after = d
		}
	}
	if after < waitExternalMin {
		after = waitExternalMin
	}
	if after > waitExternalMax {
		after = waitExternalMax
	}
	return truncateStr(why, 200), after, true
}

// parseWaitDuration reads 「2h」「90m」「1.5 小时」「30 分钟」 (summed: 「1h30m」).
func parseWaitDuration(s string) (time.Duration, bool) {
	var d time.Duration
	for _, m := range waitDuration.FindAllStringSubmatch(s, -1) {
		n, err := strconv.ParseFloat(m[1], 64)
		if err != nil {
			continue
		}
		unit := time.Minute
		if strings.HasPrefix(m[2], "h") || strings.Contains(m[2], "小时") {
			unit = time.Hour
		}
		d += time.Duration(n * float64(unit))
	}
	return d, d > 0
}

// waitingExternal: the board item is paused waiting on something outside (board.py wait).
func (it teamTaskBoardItem) waitingExternal() bool {
	return it.Paused != "" && strings.HasPrefix(it.PauseWhy, waitExternalWhy)
}

// parkWaitingExternal runs board.py wait for item hid: pause as 「等外部：why」, wait_until now+after,
// free the workspace. Off the turn's goroutine: freeing the workspace resets this very session.
func (e *Engine) parkWaitingExternal(chat string, hid int, why string, after time.Duration) {
	mins := strconv.Itoa(int(after / time.Minute))
	go func() {
		out, err := e.runLeadScript(chat, "board", "wait", strconv.Itoa(hid), why, mins)
		if err != nil {
			slog.Warn("team workspace: park as waiting on external failed", "board_item", hid, "error", err, "output", strings.TrimSpace(string(out)))
			return
		}
		slog.Info("team workspace: task waits on something outside; workspace freed, retry scheduled", "board_item", hid, "after", after, "why", truncateStr(why, 80))
	}()
}

var waitExternalTried = struct {
	sync.Mutex
	at map[string]time.Time
}{at: map[string]time.Time{}}

// retryWaitingExternal hands every 「等外部」 item whose wait_until has come back to a free workspace
// (ws-handoff --resume, the same path an answered [ask] takes). One lead engine per board directory does it.
func (w *handoffWatch) retryWaitingExternal(now time.Time) {
	if w.engines == nil {
		return
	}
	seen := map[string]bool{}
	for _, e := range w.engines() {
		if e == nil || e.team == nil || e.team.dir == "" || !e.isTeamLead() || seen[e.team.dir] {
			continue
		}
		seen[e.team.dir] = true
		for _, it := range readTeamTaskBoard(e.team.dir) {
			if !it.waitingExternal() || it.WS != "" || it.WaitUntil <= 0 || it.Chat == "" || now.Unix() < it.WaitUntil {
				continue
			}
			key := e.team.dir + "#" + strconv.Itoa(it.ID)
			waitExternalTried.Lock()
			last := waitExternalTried.at[key]
			if now.Sub(last) < waitExternalRetryGap {
				waitExternalTried.Unlock()
				continue
			}
			waitExternalTried.at[key] = now
			waitExternalTried.Unlock()
			resumeWaitingExternalFn(e, it)
		}
	}
}

// resumeWaitingExternalFn is swapped in tests.
var resumeWaitingExternalFn = (*Engine).resumeWaitingExternal

func (e *Engine) resumeWaitingExternal(it teamTaskBoardItem) {
	why := strings.TrimPrefix(it.PauseWhy, waitExternalWhy)
	note := "到点重试：上次卡在「" + why + "」。先查这个条件满足没有：满足就接着做没做完的；还不满足，不要重做已做的，" +
		"照旧交 [report]，写一行「等外部：卡在什么」和一行「再看：<多久后>」。"
	out, err := e.runLeadScript(it.Chat, "ws-handoff", "--resume", strconv.Itoa(it.ID), note)
	if err != nil {
		slog.Warn("team workspace: retry of a task waiting on external failed", "board_item", it.ID, "error", err, "output", strings.TrimSpace(string(out)))
		return
	}
	slog.Info("team workspace: waiting-on-external task handed to a workspace again", "board_item", it.ID, "chat", it.Chat)
}
