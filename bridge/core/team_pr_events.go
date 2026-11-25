package core

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// Pull request events for tasks that wait outside (#1855, user 11-21「你到底有没有搞事件触发」). #1850
// reported 「等外部，再看 1h」 on an upstream pull request; two new reviews and a check that failed in
// 20 seconds went unseen until the user saw them. A 「等外部」 item was only handed back when its
// wait_until came (team_wait_external.go).
//
// An item parked with pull request links (the ones its [report] has, or `board watch-pr`) is watched
// while it waits: every prEventsEvery the watch runs `board pr-events`, which asks GitHub once per
// pull request (gh; an upstream repository takes no webhook from us). Something new — a comment or
// review after the pause, a failed check on the head commit, the checks all finished, merged or
// closed — sets the item's wait_until to now and records one line with its link in pr_news; the main
// loop's retryWaitingExternal then hands it back the usual way, with those lines as the note.
// Nothing new: no output, no message, no turn. wait_until stays as the fallback.

// prEventsEvery — source: #1855 主角色定案 11-21「进桥看门每 2 分钟 gh 查」.
const prEventsEvery = 2 * time.Minute

func (w *handoffWatch) prEventLoop(ctx context.Context) {
	t := time.NewTicker(prEventsEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		w.checkPREvents()
	}
}

// prEventsFn is swapped in tests.
var prEventsFn = func(e *Engine, chat string) ([]byte, error) {
	return e.runLeadScript(chat, "board", "pr-events")
}

// checkPREvents runs `board pr-events` once per board directory that has a 「等外部」 item watching a
// pull request; a board with none costs one file read and no gh call.
func (w *handoffWatch) checkPREvents() {
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
			if !it.waitingExternal() || len(it.WatchPR) == 0 {
				continue
			}
			out, err := prEventsFn(e, it.Chat)
			if text := strings.TrimSpace(string(out)); err != nil {
				slog.Warn("team workspace: pull request check failed", "error", err, "output", truncateStr(text, 300))
			} else if text != "" {
				slog.Info("team workspace: pull request has news, waiting task is handed back", "output", truncateStr(text, 300))
			}
			break
		}
	}
}

// prNewsNote is the hand-back note of an item woken by its pull request: every new thing, with its link.
func prNewsNote(news []string) string {
	return "合并请求有新动静，没等到约好的时间就交回了。先逐条打开原文看，该改的改、该回的回，再接着做没做完的：\n- " +
		strings.Join(news, "\n- ") +
		"\n处理完还要等对方或等检查的，照旧交 [report]，写一行「等外部：卡在什么」（带上合并请求链接）和一行" + team.WaitAgainHint + "。"
}
