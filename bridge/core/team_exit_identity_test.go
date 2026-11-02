package core

import (
	"strings"
	"testing"
)

// A delayed, badly formatted report for the previous task must not be presented
// to the lead as the task that subsequently occupied the same workspace.
func TestWorkspaceLegacyReportKeepsNamedTask(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(p)
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 65, What: "旧预算核验", WSWas: "discord:ws1", Chat: "discord:chat1", Bound: "2026-11-02T01:00:00Z"},
		teamTaskBoardItem{ID: 60, What: "新稳定性任务", WS: "discord:ws1", Chat: "discord:chat1", Bound: "2026-11-02T02:00:00Z"},
	)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	t.Cleanup(ts.Stop)
	e.SetTimerScheduler(ts)
	e.teamExit.bounces = map[string]int{exitWSKey: exitRules.Bounce.WakeLimit}
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #65 背景：旧预算核验。\n做了什么：用量复算完成。")
	jobs := store.List()
	if len(jobs) != 1 {
		t.Fatalf("expected one lead rewrite, got %d", len(jobs))
	}
	if jobs[0].ReplyBoard != 65 || strings.Contains(jobs[0].Prompt, "任务板 #60") || !strings.Contains(jobs[0].Prompt, "任务板 #65") {
		t.Fatalf("old report attributed to another task: board=%d prompt=%s", jobs[0].ReplyBoard, jobs[0].Prompt)
	}
	if !strings.Contains(jobs[0].Prompt, "没有贴进本频道") {
		t.Fatal("a rewrite must not claim that the report was already posted")
	}
}
