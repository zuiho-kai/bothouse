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

// A first line that is only 【接】 (or 「-」) names nothing: the body is the answer, not a title.
func TestWatchAcceptBlankTitleIsNotWatched(t *testing.T) {
	for _, reply := range []string{"【接】\n一个最基础的登录页…", "【接】 -\n答案", "【接】"} {
		e, _ := acceptFixture(t)
		e.watchTurnEnded(e.platforms[0], "discord:chatA", reply, true, false, false, time.Time{})
		if got := scriptWatchesOf(e, "discord:chatA"); len(got) != 0 {
			t.Fatalf("%q: a blank title must not be watched, got %+v", reply, got)
		}
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
