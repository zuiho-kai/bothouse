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
	inputWait(t, func() bool {
		store.mu.Lock()
		defer store.mu.Unlock()
		return store.jobs[0].Fired
	})
	if jobs[0].ReplyBoard != 65 || strings.Contains(jobs[0].Prompt, "任务板 #60") || !strings.Contains(jobs[0].Prompt, "任务板 #65") {
		t.Fatalf("old report attributed to another task: board=%d prompt=%s", jobs[0].ReplyBoard, jobs[0].Prompt)
	}
	if !strings.Contains(jobs[0].Prompt, "没有贴进本频道") {
		t.Fatal("a rewrite must not claim that the report was already posted")
	}
}

func TestWorkspaceRewriteUnknownOrUnmarkedIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, reply string
		want        int
	}{
		{"unknown explicit ID", "[report] #999 背景：旧任务。\n用量核完。", 0},
		{"no explicit ID", "[report] 背景：旧任务。\n用量核完。", 0},
		{"missing marker stays local", "#65 背景：旧任务。\n用量核完。", -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
			e.SetTeam(t.TempDir(), "橘", true)
			e.markPlatformReady(p)
			if err := e.ClaimTeamWorkspaceFor("discord:chat1", "ws1", "工作区1", "", "新任务"); err != nil {
				t.Fatal(err)
			}
			writeReviewBoard(t, e,
				teamTaskBoardItem{ID: 65, What: "旧任务", WSWas: "discord:ws1", Chat: "discord:chat1", Bound: "2026-11-02T01:00:00Z"},
				teamTaskBoardItem{ID: 60, What: "新任务", WS: "discord:ws1", Chat: "discord:chat1", Bound: "2026-11-02T02:00:00Z"},
			)
			store, err := NewTimerStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			ts := NewTimerScheduler(store)
			t.Cleanup(ts.Stop)
			e.SetTimerScheduler(ts)
			e.teamExit.bounces = map[string]int{exitWSKey: exitRules.Bounce.WakeLimit}
			e.forwardWorkspaceExit(p, exitWSKey, tc.reply)
			jobs := store.List()
			if tc.want == -1 {
				if len(jobs) != 0 {
					t.Fatal("unmarked process reply was forwarded")
				}
				return
			}
			if len(jobs) != 1 {
				t.Fatalf("rewrite jobs=%d", len(jobs))
			}
			inputWait(t, func() bool { store.mu.Lock(); defer store.mu.Unlock(); return store.jobs[0].Fired })
			if jobs[0].ReplyBoard != tc.want || strings.Contains(jobs[0].Prompt, "任务板 #60") {
				t.Fatalf("wrong attribution: board=%d prompt=%s", jobs[0].ReplyBoard, jobs[0].Prompt)
			}
		})
	}
}

func TestWorkspaceLateReportDoesNotResetNewTask(t *testing.T) {
	e, _, _ := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 65, What: "旧任务", WSWas: "discord:ws1", Chat: "discord:chat1", Bound: "2026-11-02T01:00:00Z"},
		teamTaskBoardItem{ID: 60, What: "新任务", WS: "discord:ws1", Chat: "discord:chat1", Bound: "2026-11-02T02:00:00Z"},
	)
	current := e.sessions.GetOrCreateActive(exitWSKey)
	e.endWorkspaceTask("discord:chat1", exitWSKey, exitKindReport, 65)
	if e.sessions.ActiveSessionID(exitWSKey) != current.ID {
		t.Fatal("late old report reset the newer task session")
	}
}

func TestWorkspaceLateReportDeliveryAndReplayAcrossPlatforms(t *testing.T) {
	for _, platform := range []string{"discord", "feishu", "cloud_web", "qq"} {
		t.Run(platform, func(t *testing.T) {
			e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
			p.n = platform
			e.SetTeam(t.TempDir(), "橘", true)
			ws, chat := platform+":ws1:u1", platform+":chat1"
			writeReviewBoard(t, e,
				teamTaskBoardItem{ID: 65, What: "旧预算核验", WSWas: platform + ":ws1", Chat: chat, Bound: "2026-11-02T01:00:00Z"},
				teamTaskBoardItem{ID: 60, What: "新稳定性任务", WS: platform + ":ws1", Chat: chat, Bound: "2026-11-02T02:00:00Z"},
			)
			current := e.sessions.GetOrCreateActive(ws)
			report := "[report] #65 背景：旧预算核验。\n做了什么：用量复算完成。\n要你做的：没有。\n我加的：无。"
			e.forwardWorkspaceExit(p, ws, report)
			sent := p.sentTo(chat)
			if len(sent) != 1 || !strings.Contains(sent[0], "旧预算核验") || strings.Contains(sent[0], "新稳定性任务") {
				t.Fatalf("wrong public result: %v", sent)
			}
			if e.sessions.ActiveSessionID(ws) != current.ID || !e.exitReportedBefore(65) || e.exitReportedBefore(60) {
				t.Fatal("late report changed new session or wrong receipt")
			}
			// A new engine reads the persisted delivery journal after restart.
			restarted, _, p2 := exitFixture(t, mapParent{"ws1": "chat1"})
			p2.n = platform
			restarted.dataDir = e.dataDir
			restarted.SetTeam(e.teamStatusDir(), "橘", true)
			restarted.forwardWorkspaceExit(p2, ws, report)
			if len(p2.sentTo(chat)) != 0 {
				t.Fatal("restart replay posted a duplicate report")
			}
		})
	}
}
