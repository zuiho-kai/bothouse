package core

import (
	"strings"
	"testing"
)

// #207: the watch posted its own nudge into the workspace channel under the same account that
// owns the claim; ownerSpoke read it as the owner speaking, renewed the claim, and the task was
// nudged again every check window (user 2026-11-06 10:53 「这种情况是为什么。好几个工作区都这样」).
func TestWatchNudgeTextIsNotProgress(t *testing.T) {
	cases := []TeamHandoff{
		{Owner: "1472561359663253256", Title: "【免审:小改动】任务板根治A 重派"},
		{Owner: "", Title: "叠板"},
		{Owner: "", Title: ""},
	}
	for _, h := range cases {
		txt := watchNudgeText("discord", h)
		if watchIsProgressText(txt) {
			t.Fatalf("the watch's own nudge counts as progress: %q", txt)
		}
		// With the mention that a real owner gets prefixed, the mention must be stripped first.
		if !strings.HasPrefix(txt, "到了检查时间还没交回") && watchIsProgressText(txt) {
			t.Fatalf("nudge with an owner mention counts as progress: %q", txt)
		}
	}
}

// The other two notices the watch posts are equally not progress.
func TestWatchParkedNoticesAreNotProgress(t *testing.T) {
	for _, txt := range []string{
		"看门：<#1563964848755314753>「叠板」续过一次仍没有进展，已暂停并放回工作区；要继续请重新交活。",
		"看门暂停失败：<#1563964848755314753>：workspace not owned",
	} {
		if watchIsProgressText(txt) {
			t.Fatalf("watch notice counts as progress: %q", txt)
		}
	}
}

// The exclusion must not swallow real hand-backs: a workspace saying it is done still counts.
func TestRealHandBackStillCountsAsProgress(t *testing.T) {
	for _, txt := range []string{
		"<@1560508467733860372> 交回：改完了，分支 fix/x，测试通过。",
		"【接】我先核对交接。",
	} {
		want := !strings.HasPrefix(txt, "【接】")
		if got := watchIsProgressText(txt); got != want {
			t.Fatalf("watchIsProgressText(%q) = %v, want %v", txt, got, want)
		}
	}
}
