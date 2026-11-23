package core

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// #1855: a report that waits outside is parked with the pull requests it links.
func TestPullRequestLinksOfReport(t *testing.T) {
	body := "[report] 改好推了 https://github.com/InferMatrixLab/InferRSI/pull/544 。\n等外部：等审核人复审（https://github.com/InferMatrixLab/InferRSI/pull/544#issuecomment-1）\n再看：1h"
	if got, want := team.PullRequestLinks(body), []string{"https://github.com/InferMatrixLab/InferRSI/pull/544"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("links %v, want %v", got, want)
	}
	if got := team.PullRequestLinks("等外部：GPU 全占"); len(got) != 0 {
		t.Fatalf("links %v, want none", got)
	}
}

// #1855: the pull request check runs only for a board with a 「等外部」 item that watches one, and an item
// it woke (wait_until now, pr_news) is handed back with every new thing and its link.
func TestPREventsWakeWaitingTask(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, reviewTestPlatforms(), "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	now := time.Now()
	calls := 0
	origCheck := prEventsFn
	prEventsFn = func(_ *Engine, _ string) ([]byte, error) { calls++; return nil, nil }
	t.Cleanup(func() { prEventsFn = origCheck })
	w := newHandoffWatch(e)
	w.engines = func() []*Engine { return []*Engine{e} }

	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 1, What: "gpu", Chat: "room:main", Paused: "11-21 18:00", PauseWhy: team.WaitExternalWhy + "GPU 全占", WaitUntil: now.Add(time.Hour).Unix()},
		teamTaskBoardItem{ID: 2, What: "running", Chat: "room:main", WS: "room:ws1", WatchPR: []string{"https://github.com/o/r/pull/7"}},
	)
	w.checkPREvents()
	if calls != 0 {
		t.Fatalf("checked GitHub %d times with nothing watching a pull request", calls)
	}

	news := []string{"新评论（amy）：https://github.com/o/r/pull/7#issuecomment-2"}
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 3, What: "pr", Chat: "room:main", Paused: "11-21 18:00", PausedAt: "a", PauseWhy: team.WaitExternalWhy + "等复审", WaitUntil: now.Add(time.Hour).Unix(), WatchPR: []string{"https://github.com/o/r/pull/7"}},
	)
	w.checkPREvents()
	if calls != 1 {
		t.Fatalf("checked GitHub %d times, want 1", calls)
	}
	var got []teamTaskBoardItem
	origResume := resumeWaitingExternalFn
	resumeWaitingExternalFn = func(_ *Engine, it teamTaskBoardItem) { got = append(got, it) }
	t.Cleanup(func() { resumeWaitingExternalFn = origResume })
	w.retryWaitingExternal(now)
	if len(got) != 0 {
		t.Fatalf("handed back before its time with no news: %+v", got)
	}
	// board.py pr-events found a comment: wait_until is now, pr_news has the line.
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 3, What: "pr", Chat: "room:main", Paused: "11-21 18:00", PausedAt: "a", PauseWhy: team.WaitExternalWhy + "等复审", WaitUntil: now.Unix(), WatchPR: []string{"https://github.com/o/r/pull/7"}, PRNews: news},
	)
	w.retryWaitingExternal(now)
	if len(got) != 1 || got[0].ID != 3 {
		t.Fatalf("handed back %+v, want #3", got)
	}
	if note := prNewsNote(got[0].PRNews); !strings.Contains(note, news[0]) {
		t.Fatalf("hand-back note lacks the comment link: %s", note)
	}
	// parked again inside the retry gap of that hand-back, then woken again: a new pause is tried at once
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 3, What: "pr", Chat: "room:main", Paused: "11-21 18:05", PausedAt: "b", PauseWhy: team.WaitExternalWhy + "等复审", WaitUntil: now.Unix(), WatchPR: []string{"https://github.com/o/r/pull/7"}, PRNews: news},
	)
	w.retryWaitingExternal(now.Add(time.Minute))
	if len(got) != 2 {
		t.Fatalf("a second pause woken inside the retry gap was not handed back: %d", len(got))
	}
}
