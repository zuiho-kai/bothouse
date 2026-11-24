package core

import (
	"errors"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
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
	// waitExternalRetryGap: a failed resume (no free workspace script, bridge busy) is tried again after this.
	waitExternalRetryGap = 10 * time.Minute
	// waitExternalConfigExit: ws-handoff's exit code for a failure retrying cannot fix (EXIT_CONFIG).
	waitExternalConfigExit = 3
)

// waitExternalConfigWhy: the line of ws-handoff's output that says what is misconfigured, for the board.
func waitExternalConfigWhy(out string) string {
	for _, l := range strings.Split(out, "\n") {
		l = strings.TrimSpace(l)
		if strings.Contains(l, "不能用") || strings.Contains(l, "没切成") {
			return shortLabel(strings.TrimPrefix(l, "ws-handoff: "), 150)
		}
	}
	return "配置错，再试也一样"
}

// waitingExternal: the board item is paused waiting on something outside (board.py wait).
func (it teamTaskBoardItem) waitingExternal() bool {
	return it.Paused != "" && it.waitsOn(teamWaitExternal)
}

// parkWaitingExternal runs board.py wait for item hid: pause as 「等外部：why」, wait_until now+after,
// free the workspace. Off the turn's goroutine: freeing the workspace resets this very session.
// prs are the pull requests the report links: board.py records them, and they are watched while the
// item waits (team_pr_events.go).
func (e *Engine) parkWaitingExternal(chat string, hid int, why string, after time.Duration, prs []string) {
	mins := strconv.Itoa(int(after / time.Minute))
	go func() {
		out, err := e.runLeadScript(chat, "board", append([]string{"wait", strconv.Itoa(hid), why, mins}, prs...)...)
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
			// #1786: the project is cooling down after quota exhaustion — every workspace claim would fail the
			// same way, and ws-handoff used to create a new workspace each time (11-18: 工作区12–37, one per
			// ten minutes). Skip this round; the item stays due and is tried once the cooldown is over.
			if until := e.quotaCoolingFor(e.admissionQuotaScope(e.agent, it.Chat)); !until.IsZero() {
				coolingSkipLog(e.team.dir, it.ID, until)
				continue
			}
			// One pause is one series of tries: an item parked again inside the gap of its last hand-back
			// and woken by its pull request (team_pr_events.go) is not held back by that older try.
			key := e.team.dir + "#" + strconv.Itoa(it.ID) + "#" + it.PausedAt
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

var waitExternalCoolLogged = struct {
	sync.Mutex
	at map[string]time.Time
}{at: map[string]time.Time{}}

// coolingSkipLog logs a skipped retry once per cooldown, not every watch tick.
func coolingSkipLog(dir string, id int, until time.Time) {
	key := dir + "#" + strconv.Itoa(id)
	waitExternalCoolLogged.Lock()
	defer waitExternalCoolLogged.Unlock()
	if waitExternalCoolLogged.at[key].Equal(until) {
		return
	}
	waitExternalCoolLogged.at[key] = until
	slog.Info("team workspace: project cooling, retry of a task waiting on external skipped", "board_item", id, "until", until)
}

// resumeWaitingExternalFn is swapped in tests.
var resumeWaitingExternalFn = (*Engine).resumeWaitingExternal

func (e *Engine) resumeWaitingExternal(it teamTaskBoardItem) {
	why := strings.TrimPrefix(it.PauseWhy, team.WaitExternalWhy)
	note := "到点重试：上次卡在「" + why + "」。先查这个条件满足没有：满足就接着做没做完的；还不满足，不要重做已做的，" +
		"照旧交 [report]，写一行「等外部：卡在什么」和一行「再看：<多久后或到点钟点，如 2h、11-23 18:00>」。"
	if len(it.PRNews) > 0 {
		note = prNewsNote(it.PRNews)
	}
	out, err := e.runLeadScript(it.Chat, "ws-handoff", "--resume", strconv.Itoa(it.ID), note)
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && ee.ExitCode() == waitExternalConfigExit {
			// #1972: a config failure (the recorded model is not in the list, or will not switch) fails the
			// same way every ten minutes (11-24: 210 failed retries, all 「模型 保持现状 没切成」). Stop the
			// retries once; the item stays paused and the chat hears ② once (team_chat_state.go).
			why := waitExternalConfigWhy(string(out))
			if sout, serr := e.runLeadScript(it.Chat, "board", "wait-stop", strconv.Itoa(it.ID), why); serr != nil {
				slog.Warn("team workspace: stopping retries of a misconfigured task failed", "board_item", it.ID, "error", serr, "output", strings.TrimSpace(string(sout)))
			}
			slog.Warn("team workspace: retry of a task waiting on external stopped: config error", "board_item", it.ID, "why", why)
			return
		}
		slog.Warn("team workspace: retry of a task waiting on external failed", "board_item", it.ID, "error", err, "output", strings.TrimSpace(string(out)))
		return
	}
	slog.Info("team workspace: waiting-on-external task handed to a workspace again", "board_item", it.ID, "chat", it.Chat)
}
