package core

import (
	"testing"
	"time"
)

// A bounced report's repair turn must not post a second report when another turn of the same
// handoff reported the item first (11-02 #958 posted twice); a new handoff posts again.
func TestWorkspaceSecondReportForSameHandoffNotPosted(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(p)
	bound := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	item := teamTaskBoardItem{ID: 958, What: "回报转发", WS: exitWSKey, Chat: "discord:chat1", Bound: bound, Dispatcher: e.name}
	writeReviewBoard(t, e, item)
	e.postExitHeadline(e.ctx, p, "discord:chat1", "chat1", "ws1", "橘", exitKindReport, "做了什么：第一版", exitWSKey, 958, "修好了", &item)
	if !e.exitReportedSinceBound(958, bound) {
		t.Fatal("first report not recorded")
	}
	n := len(p.sentTo("discord:chat1"))
	e.postExitHeadline(e.ctx, p, "discord:chat1", "chat1", "ws1", "橘", exitKindReport, "做了什么：补交版", exitWSKey, 958, "修好了，补上范围", &item)
	if got := len(p.sentTo("discord:chat1")); got != n {
		t.Fatalf("second report for the same handoff was posted: %d -> %d", n, got)
	}
	item.Bound = time.Now().Add(time.Second).UTC().Format(time.RFC3339Nano)
	if e.exitReportedSinceBound(958, item.Bound) {
		t.Fatal("a re-bound handoff must be allowed to report")
	}
}
