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
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, false, false, false, false, time.Time{})
		if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 0 {
			t.Fatalf("%q: a tool-less chat answer must not be watched, got %+v", reply, got)
		}
	}
}

// Work started in the turn (a tool ran) is still watched, titled from the first line.
func TestWatchChatAcceptWithWorkIsWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	e.watchTurnEnded(e.platforms[0], "discord:chatA", "【接】修登录页样式\n先看了 css，接下来改按钮", true, false, false, false, time.Time{})
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
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, true, false, false, false, time.Time{})
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
	e.watchTurnEnded(e.platforms[0], "discord:ws1", "【接】改登录页\n先读交接", false, false, false, false, time.Time{})
	if got := scriptWatchesOf(e, "discord:ws1"); len(got) != 1 || got[0].Title != "改登录页" || got[0].Chat != "discord:chat1" {
		t.Fatalf("a tool-less 【接】 in a workspace must be watched for its chat channel, got %+v", got)
	}
}

// A board item this channel owns keeps the watch when the first line names no #id: the board says
// the work is open, so the turn did not answer it in chat.
func TestWatchChatAcceptBoardActiveWithoutNumberIsWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	writeReleaseBoard(t, e, map[string]any{"id": 9, "what": "接上游的接口", "status": "进行中", "who": "橘", "ws": "discord:chatA"})
	e.watchTurnEnded(e.platforms[0], "discord:chatA", "【接】\n这就开始", false, false, false, false, time.Time{})
	if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 1 || got[0].Board != 9 || got[0].Title != "#9 接上游的接口" {
		t.Fatalf("an active board item must be watched under its board title, got %+v", got)
	}
}

// A board item named on the first line keeps the watch even without tools: it is real work.
func TestWatchChatAcceptNamingBoardItemIsWatched(t *testing.T) {
	e, _ := acceptFixture(t)
	writeReleaseBoard(t, e, map[string]any{"id": 9, "what": "接上游的接口", "status": "进行中", "who": "橘", "ws": "discord:chatA"})
	e.watchTurnEnded(e.platforms[0], "discord:chatA", "【接】#9 这就开始", false, false, false, false, time.Time{})
	if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 1 || got[0].Board != 9 {
		t.Fatalf("an accepted board item must be watched, got %+v", got)
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
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, true, false, false, time.Time{})
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
	e.watchTurnEnded(e.platforms[0], "discord:ws1", "先读了交接，接下来改接口", true, false, false, time.Time{})
	if got := scriptWatchesOf(e, "discord:ws1"); len(got) != 1 || got[0].Board != 9 {
		t.Fatalf("a workspace's active board item must stay watched, got %+v", got)
	}
}
