package core

import (
	"testing"
	"time"
)

func scriptWatchesOf(e *Engine, key string) []TeamHandoff {
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	return append([]TeamHandoff(nil), loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).ScriptWatches[key]...)
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
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, false, false, false, time.Time{})
		if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 0 {
			t.Fatalf("%q: a tool-less chat answer must not be watched, got %+v", reply, got)
		}
	}
}

// Work started in the turn (a tool ran) is still watched, titled from the first line.
func TestWatchChatAcceptWithWorkIsWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	e.watchTurnEnded(e.platforms[0], "discord:chatA", "【接】修登录页样式\n先看了 css，接下来改按钮", true, false, false, time.Time{})
	got := scriptWatchesOf(e, "discord:chatA")
	if len(got) != 1 || got[0].Title != "修登录页样式" {
		t.Fatalf("accepted work with tool use must be watched by its title, got %+v", got)
	}
}

// A first line that is only 【接】 (or 「-」) names nothing, yet a turn that ran a tool is real work:
// it is still watched, under the fixed fallback title rather than the body (PR #1194 review).
func TestWatchAcceptBlankTitleWithWorkUsesFallbackTitle(t *testing.T) {
	for _, reply := range []string{"【接】\n一个最基础的登录页…", "【接】 -\n答案", "【接】"} {
		e, _ := acceptFixture(t)
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, true, false, false, time.Time{})
		got := scriptWatchesOf(e, "discord:chatA")
		if want := e.i18n.T(MsgWatchUntitledAccept); len(got) != 1 || got[0].Title != want {
			t.Fatalf("%q: a bare 【接】 with tool use must be watched as %q, got %+v", reply, want, got)
		}
	}
}

// In a workspace a 【接】 is accepted work even when the turn ran no tool: the answered-in-chat
// rule is for chat channels only.
func TestWatchWorkspaceAcceptWithoutToolsIsWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{Parents: map[string][]TeamWorkspace{
		"discord:chat1": {{Name: "工作区1", ID: "ws1"}},
	}, Version: teamWorkspaceStateVersion})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	e.watchTurnEnded(e.platforms[0], "discord:ws1", "【接】改登录页\n先读交接", false, false, false, time.Time{})
	if got := scriptWatchesOf(e, "discord:ws1"); len(got) != 1 || got[0].Title != "改登录页" || got[0].Chat != "discord:chat1" {
		t.Fatalf("a tool-less 【接】 in a workspace must be watched for its chat channel, got %+v", got)
	}
}

// A board item this channel owns keeps the watch when the first line names no #id: the board says
// the work is open, so the turn did not answer it in chat.
func TestWatchChatAcceptBoardActiveWithoutNumberIsWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	writeReleaseBoard(t, e, map[string]any{"id": 9, "what": "接上游的接口", "status": "进行中", "who": "橘", "ws": "discord:chatA"})
	e.watchTurnEnded(e.platforms[0], "discord:chatA", "【接】\n这就开始", false, false, false, time.Time{})
	if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 1 || got[0].Board != 9 || got[0].Title != "#9 接上游的接口" {
		t.Fatalf("an active board item must be watched under its board title, got %+v", got)
	}
}

// A board item named on the first line keeps the watch even without tools: it is real work.
func TestWatchChatAcceptNamingBoardItemIsWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	writeReleaseBoard(t, e, map[string]any{"id": 9, "what": "接上游的接口", "status": "进行中", "who": "橘", "ws": "discord:chatA"})
	e.watchTurnEnded(e.platforms[0], "discord:chatA", "【接】#9 这就开始", false, false, false, time.Time{})
	if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 1 || got[0].Board != 9 {
		t.Fatalf("an accepted board item must be watched, got %+v", got)
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
	st := loadTeamWorkspacesLocked(path)
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
	st := loadTeamWorkspacesLocked(path)
	if script {
		return append([]TeamHandoff(nil), st.ScriptWatches[key]...)
	}
	return append([]TeamHandoff(nil), st.Handoffs[key]...)
}

// A [report] with no board number cannot satisfy the headline check, so it must end its watch
// instead of being treated as a reply still to be repaired: the resend rule only bounces reports
// that name a board item (#96, 11-05: the same board-less report woke the workspace again and
// again).
func TestWatchTurnEnded_BoardlessReportEndsWatch(t *testing.T) {
	const report = "[report] 背景：看门遇到没写任务板编号的交回，已经改成能收口\n\n要你做的：没有"
	for _, script := range []bool{true, false} {
		name := "handoff"
		if script {
			name = "script_watch"
		}
		t.Run(name, func(t *testing.T) {
			e, p := idleWatchFixture(t)
			key := "discord:ws96"
			at := time.Now().Add(-2 * time.Minute)
			idleWatchSeed(t, e, key, script, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "看门死循环"})

			for i := 0; i < 2; i++ { // a resend or a second reply must not open it again
				e.watchTurnEnded(p, key+":u1", report, false, false, false, time.Time{})
				rows := idleWatchRows(t, e, key, script)
				if len(rows) != 1 {
					t.Fatalf("reply %d: rows = %d, want 1", i, len(rows))
				}
				h := rows[0]
				if !h.Idle.Returned {
					t.Fatalf("reply %d: a board-less [report] left the watch open: %+v", i, h.Idle)
				}
				if h.Idle.Wakes != 0 || h.Idle.Reported {
					t.Fatalf("reply %d: the watch kept waking: %+v", i, h.Idle)
				}
			}
		})
	}
}

// A [report] that names a board item whose headline is wrong is still resent, not handed back:
// the workspace can repair that one, and forwardWorkspaceExit is already asking it to.
func TestWatchTurnEnded_ReportWithBoardNumberKeepsResending(t *testing.T) {
	e, p := idleWatchFixture(t)
	key := "discord:ws97"
	at := time.Now().Add(-2 * time.Minute)
	idleWatchSeed(t, e, key, true, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "带板号的交回"})

	e.watchTurnEnded(p, key+":u1", "[report] #77 背景：这件活做完了\n\n要你做的：没有", false, false, false, time.Time{})

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

	e.watchTurnEnded(p, key+":u1", "接着做，还在跑，这里先说一声进展", true, false, false, time.Time{})

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
	e2.watchTurnEnded(p2, key+":u1", "接着做，还在跑", true, false, false, time.Time{})
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

	e.watchTurnEnded(p, key+":u1", "还在做，先说一声进展", true, false, false, time.Time{})

	// Fails clearing is the old, intended reset (progress); the reported mark and the wake count
	// it escalated on must stay, or the same row wakes and escalates again.
	live := idleWatchRows(t, e, key, false)[0].Idle
	if !live.Reported || live.Wakes != 1 {
		t.Fatalf("the stuck live row was revived by a turn that ran tools: %+v", live)
	}
}
