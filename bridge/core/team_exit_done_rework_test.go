package core

import (
	"testing"
	"time"
)

// #1492 常识：去重按一次交接算。A task done after round 1 (its report posted) and handed out again
// for rework is re-bound; the worker's `board done` before its round-2 report must not make that
// report a 「late nudge」 answer just because round 1 was posted within 7 days.
func TestReworkReportOfADoneItemIsNotDropped(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.platformReady = map[Platform]bool{p: true}
	e.markExitReported(9) // round 1 posted
	bound := time.Now().Add(time.Second).UTC().Format(time.RFC3339Nano)
	item := &teamTaskBoardItem{ID: 9, What: "返工", DoneAt: "11-12 11:00", Bound: bound, Chat: "discord:chat1"}
	body := "[report] #9 背景：你让我返工。\n返工做完\n要你做的：没有。\n我加的：无"
	e.holdReportForLead(e.ctx, p, "chat1", "ws1", "橘", body, exitWSKey, 9, "[report] #9 背景：你让我返工。", "", "", item)
	if e.heldReportFor(9) == nil && len(p.sentTo("discord:chat1")) == 0 {
		t.Fatal("the rework report of a re-bound done item was dropped as already posted")
	}
}
