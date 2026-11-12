package core

import (
	"testing"
	"time"
)

func scriptWatchesOf(e *Engine, key string) []TeamHandoff {
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	return append([]TeamHandoff(nil), testLoadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).ScriptWatches[key]...)
}

func acceptFixture(t *testing.T) (*Engine, *exitTestPlatform) {
	t.Helper()
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(p)
	return e, p
}

// #221 (11-06 09:25): one-line answers in the chat channel opened with 【接】 and ran no tool. They
// were the whole answer; registering them sent 「接着做 -」 twice and escalated to the lead.
func TestWatchChatAcceptAnsweredInTurnIsNotWatched(t *testing.T) {
	for _, reply := range []string{
		"【接】\n一个最基础的登录页，最少要有账号输入框、密码输入框和登录提交按钮这三样东西。",
		"【接】什么东西属于你，别人却比你用得更多？",
		"<@1>【接】马上做",
	} {
		e, _ := acceptFixture(t)
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, false, false, false, false, time.Time{})
		if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 0 {
			t.Fatalf("%q: a tool-less chat answer must not be watched, got %+v", reply, got)
		}
	}
}

// #1407 (11-10 agentm): 橘 asked 鲸鱼娘 for 「在+模型名」; she ran one tool (`bothouse model list`) and
// answered 「【接】在。\n我现在用的是 deepseek-v4.1-flash…」. The tool call was taken for work in flight
// and the watch woke her with 「还没交出去…交工作区」 three times. In a chat channel a 【接】 with no
// board item is answered there, tools or not; real work goes to a workspace and is watched there.
func TestWatchChatAcceptWithToolsButNoBoardItemIsNotWatched(t *testing.T) {
	for _, reply := range []string{
		"【接】在。\n\n我现在用的是 deepseek-v4.1-flash（deepseek-official 提供），推理档 high；桥当前只报出这一个模型。",
		"【接】修登录页样式\n先看了 css，接下来改按钮",
		"【接】\n一个最基础的登录页…",
		"【接】",
	} {
		e, _ := acceptFixture(t)
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, true, false, false, false, time.Time{})
		if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 0 {
			t.Fatalf("%q: a chat 【接】 with no board item must not be watched even with tool use, got %+v", reply, got)
		}
	}
}

// #1167 (11-07): the lead's chat channel got 「接着做 #1162」 after every lead turn. #1162 was handed
// back by its workspace (awaiting review, workspace released, so it fell back to the chat) and #1167
// was the lead's own board note; neither is work left running in the chat channel. A turn there
// without 【接】 registers no watch; a workspace keeps its board-owned watch.
func TestWatchChatBoardItemsWithoutAcceptAreNotWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	writeReleaseBoard(t, e,
		map[string]any{"id": 1162, "what": "搏仓第二版", "status": "已交回待验收", "who": "橘", "sk": "discord:chatA",
			"chat": "discord:chatA", "ws_was": "discord:ws2", "returned_at": "2026-11-07T04:00:58+09:00"},
		map[string]any{"id": 1167, "what": "桥 bug：主频道看门", "status": "在做", "who": "橘", "sk": "discord:chatA"},
	)
	for _, reply := range []string{"NO_REPLY", "看了一下，先这样", "接着做 #1162 的验收"} {
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, true, false, false, false, time.Time{})
		if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 0 {
			t.Fatalf("%q: board items alone must not watch the chat channel, got %+v", reply, got)
		}
	}
}

func TestWatchWorkspaceBoardItemWithoutAcceptIsWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{Parents: map[string][]TeamWorkspace{
		"discord:chat1": {{Name: "工作区1", ID: "ws1"}},
	}, Version: teamWorkspaceStateVersion})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	writeReleaseBoard(t, e, map[string]any{"id": 9, "what": "接上游的接口", "status": "进行中", "who": "橘", "ws": "discord:ws1", "chat": "discord:chat1"})
	e.watchTurnEnded(e.platforms[0], "discord:ws1", "先读了交接，接下来改接口", true, false, false, false, time.Time{})
	if got := scriptWatchesOf(e, "discord:ws1"); len(got) != 1 || got[0].Board != 9 {
		t.Fatalf("a workspace's active board item must stay watched, got %+v", got)
	}
}

// #1183: a watch with no board number past its due time is left over; the owner's next unrelated
// turn closes it instead of re-arming 「接着做」.
func TestWatchStaleNumberlessWatchClosesOnNextTurn(t *testing.T) {
	e, _ := acceptFixture(t)
	old := time.Now().Add(-10 * time.Hour)
	owner := e.name
	if m, ok := e.platforms[0].(SelfMentioner); ok && m.SelfMention() != "" {
		owner = m.SelfMention()
	}
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{Version: teamWorkspaceStateVersion,
		ScriptWatches: map[string][]TeamHandoff{"discord:chatA": {{Chat: "discord:chatA", At: old, Due: old.Add(10 * time.Minute),
			Owner: owner, Title: "先核对任务状态和实际产物", Sender: e.name, Idle: watchIdleState{Ended: old.Add(time.Minute), Wakes: 1}}}}})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	e.watchTurnEnded(e.platforms[0], "discord:chatA", "今天主要核对了搏仓第二版。", true, false, false, false, time.Time{})
	got := scriptWatchesOf(e, "discord:chatA")
	if len(got) != 1 || got[0].Closed.IsZero() {
		t.Fatalf("a numberless watch idle for hours must close on the owner's next turn, got %+v", got)
	}
}

// #1183 follow-up: the board is checked right before 「接着做」 is sent, not only at registration. A
// numberless watch past its due time is closed there without a wake; one still within due wakes.
func TestWatchNumberlessWatchPastDueClosesBeforeWake(t *testing.T) {
	for _, tc := range []struct {
		name  string
		due   time.Duration
		close bool
	}{{"past due", -time.Minute, true}, {"within due", 5 * time.Minute, false}} {
		e, _ := acceptFixture(t)
		now := time.Now()
		h := TeamHandoff{Chat: "discord:chatA", At: now.Add(-10 * time.Minute), Due: now.Add(tc.due), Owner: e.name, Title: "先核对任务状态", Sender: e.name, Idle: watchIdleState{Ended: now}}
		teamWorkspaceStore.mu.Lock()
		err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{Version: teamWorkspaceStateVersion,
			ScriptWatches: map[string][]TeamHandoff{"discord:chatA": {h}}})
		teamWorkspaceStore.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		e.fireIdleWake(idleAssignment{"discord:chatA", h, true})
		got := scriptWatchesOf(e, "discord:chatA")
		if len(got) != 1 {
			t.Fatalf("%s: got %+v", tc.name, got)
		}
		if closed := !got[0].Closed.IsZero(); closed != tc.close || tc.close && got[0].Idle.Wakes != 0 || !tc.close && got[0].Idle.Wakes != 1 {
			t.Fatalf("%s: closed=%v wakes=%d, want closed=%v", tc.name, closed, got[0].Idle.Wakes, tc.close)
		}
	}
}

// idleWatchFixture: an engine with a disk-backed workspace store, so a test can seed the watches
// watchTurnEnded reads and check what it wrote back.
func idleWatchFixture(t *testing.T) (*Engine, *exitTestPlatform) {
	t.Helper()
	e, _, p := exitFixture(t, nil)
	dir := e.dataDir
	t.Cleanup(func() {
		teamWorkspaceStore.mu.Lock()
		delete(teamWorkspaceStore.cache, teamWorkspacePath(dir))
		teamWorkspaceStore.mu.Unlock()
	})
	return e, p
}

// idleWatchSeed registers an open watch for key; script picks the board-less map (#96's
// "no board number" direct assignments) or the handoff map.
func idleWatchSeed(t *testing.T, e *Engine, key string, script bool, h TeamHandoff) {
	t.Helper()
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := testLoadTeamWorkspacesLocked(path)
	if h.Board == 0 {
		// develop closes a past-due watch with no board item as stale before it reads the turn
		// (watchStale); give the seed a board number so these cases reach the #96 logic.
		h.Board = 96
	}
	if script {
		st.ScriptWatches = map[string][]TeamHandoff{key: {h}}
	} else {
		st.Handoffs = map[string][]TeamHandoff{key: {h}}
	}
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		t.Fatal(err)
	}
}

func idleWatchRows(t *testing.T, e *Engine, key string, script bool) []TeamHandoff {
	t.Helper()
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := testLoadTeamWorkspacesLocked(path)
	if script {
		return append([]TeamHandoff(nil), st.ScriptWatches[key]...)
	}
	return append([]TeamHandoff(nil), st.Handoffs[key]...)
}

// A [report] that names a board item whose headline is wrong is still resent, not handed back:
// the workspace can repair that one, and forwardWorkspaceExit is already asking it to.
func TestWatchTurnEnded_ReportWithBoardNumberKeepsResending(t *testing.T) {
	e, p := idleWatchFixture(t)
	key := "discord:ws97"
	at := time.Now().Add(-2 * time.Minute)
	idleWatchSeed(t, e, key, true, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "带板号的交回"})

	e.watchTurnEnded(p, key+":u1", "[report] #77 背景：这件活做完了\n\n要你做的：没有", false, false, false, false, time.Time{})

	rows := idleWatchRows(t, e, key, true)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].Idle.Returned {
		t.Fatalf("a report naming #77 with a headline to repair was taken as handed back: %+v", rows[0].Idle)
	}
}

// A watch that already gave up (two unanswered wakes, or the failure limit) stays given up when a
// later turn happens to run tools: clearing the counters there revived it, so the same assignment
// woke and escalated again and again (#96).
func TestWatchTurnEnded_WorkDoesNotReviveReportedWatch(t *testing.T) {
	e, p := idleWatchFixture(t)
	key := "discord:ws98"
	at := time.Now().Add(-2 * time.Minute)
	idleWatchSeed(t, e, key, true, TeamHandoff{
		Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "已经升级主角色",
		Idle: watchIdleState{Ended: at, Wakes: 2, Reported: true},
	})

	e.watchTurnEnded(p, key+":u1", "接着做，还在跑，这里先说一声进展", true, false, false, false, time.Time{})

	rows := idleWatchRows(t, e, key, true)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	h := rows[0]
	if !h.Idle.Reported {
		t.Fatalf("a reported watch lost its reported mark after a turn that ran tools: %+v", h.Idle)
	}
	if h.Idle.Wakes != 2 {
		t.Fatalf("wakes = %d, want 2 (kept for the escalation already made)", h.Idle.Wakes)
	}

	// A watch that is still working keeps the old reset: progress clears the wake count.
	e2, p2 := idleWatchFixture(t)
	idleWatchSeed(t, e2, key, true, TeamHandoff{
		Chat: key, At: at, Due: at.Add(time.Minute), Owner: e2.name, Title: "还在做",
		Idle: watchIdleState{Ended: at, Wakes: 1},
	})
	e2.watchTurnEnded(p2, key+":u1", "接着做，还在跑", true, false, false, false, time.Time{})
	if got := idleWatchRows(t, e2, key, true)[0].Idle.Wakes; got != 0 {
		t.Fatalf("wakes = %d after real work, want 0", got)
	}

}

// The rows actually stuck on 11-05: a board-less handoff whose owner had already reported, with
// the failure count at the limit. A later turn that runs tools must leave them reported.
func TestWatchTurnEnded_LiveStuckRowNotRevived(t *testing.T) {
	e, p := idleWatchFixture(t)
	key := "discord:1564106353012777004"
	at := time.Now().Add(-2 * time.Minute)
	idleWatchSeed(t, e, key, false, TeamHandoff{
		Chat: "discord:1560508467733860372", At: at, Due: at.Add(time.Minute), Owner: e.name,
		Sender: "deep", Name: "工作区4", Renewed: 15,
		Title: "任务板根治A：交回自动绑PR收口、无绑定条目报警、交回自动派非作者验收",
		Idle:  watchIdleState{Ended: at, Wakes: 1, Fails: 3, Reported: true},
	})

	e.watchTurnEnded(p, key+":u1", "还在做，先说一声进展", true, false, false, false, time.Time{})

	// Fails clearing is the old, intended reset (progress); the reported mark and the wake count
	// it escalated on must stay, or the same row wakes and escalates again.
	live := idleWatchRows(t, e, key, false)[0].Idle
	if !live.Reported || live.Wakes != 1 {
		t.Fatalf("the stuck live row was revived by a turn that ran tools: %+v", live)
	}
}

// #497 (11-09): the very row that got two sessions killed. Its status is work in progress that
// happens to mention 「已完成」, and the old strings.Contains test read it as a finished item.
const watchBoardWorkInProgress = "在做：脱敏实现+单测+隔离实例截图已完成，PR #1382 草稿已开，CI 跑完即交回"

// #497: reconcileTeamWorkspaces frees a workspace by looking only at the bound board item
// (team_workspace_one.go:244). With the anchored test, the in-progress row above keeps it live;
// before the fix the same row made the workspace stale and reset the session.
func TestReconcileTeamWorkspacesKeepsWorkspaceOfInProgressRow(t *testing.T) {
	for _, tc := range []struct {
		status string
		freed  bool
	}{
		{watchBoardWorkInProgress, false},
		{"已完成", false}, // #699 D: a status text does not close a row; board done takes it off the board
	} {
		e, _, _ := exitFixture(t, nil)
		e.SetTeam(t.TempDir(), "橘", true)
		if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
			t.Fatal(err)
		}
		now := time.Now()
		writeReviewBoard(t, e, teamTaskBoardItem{ID: 497, What: "看门误判", Who: "工作区1橘",
			Status: tc.status, WS: "discord:ws1", SK: "discord:ws1", Chat: "discord:chatA"})
		teamWorkspaceStore.mu.Lock()
		path := teamWorkspacePath(e.dataDir)
		st := testLoadTeamWorkspacesLocked(path)
		st.Handoffs["discord:ws1"] = []TeamHandoff{{Chat: "discord:chatA", At: now.Add(-time.Hour),
			Due: now.Add(time.Minute), Owner: e.name, Board: 497, Sender: e.name, Name: "工作区1"}}
		err := saveTeamWorkspacesLocked(path, st)
		teamWorkspaceStore.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		w := newHandoffWatch(e)
		freed := len(w.reconcileTeamWorkspaces(now)) > 0
		if freed != tc.freed {
			t.Fatalf("status %q: freed=%v, want %v", tc.status, freed, tc.freed)
		}
	}
}
