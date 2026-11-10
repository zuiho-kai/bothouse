package core

import (
	"strings"
	"testing"
)

// The 11-10 17:10 report the user called too long (「为什么回复那么长」): 背景 six sentences, 做了什么
// seven. It goes back naming both parts; a two-sentence report passes; nothing is cut.
func TestLengthProblemsBouncesLongParts(t *testing.T) {
	long := "背景：外部用户在 agentm 上碰到了四件事。内部核对文字被贴进了他们的频道。他要跑性能分析，却收到一份代码审查报告。他问进度，它答不上来。频道里还挂着一张「处理中」卡片。你说「完全不可用」，要我们按根因修，不按现象修。\n" +
		"四个现象追到了四个根因。每个根因只改了源头那一处，已经合进开发分支。核对文字现在只交给验收的人。验收一放行，任务板上同时结案，旧活不会再被翻出来重做。主角色每轮都能看到完整的任务板，被问进度时可以直接回答。系统内部的轮次不再在用户频道里显示卡片。我刚核过版本：agentm 现在跑的是 v0.1.63，里面没有这次的修复，换上新版才生效。\n" +
		"要你做的：没有。按交接，给 agentm 换桥另外问你，这次没有动。\n我加的：任务板加了一个结案命令。"
	got := lengthProblems(long)
	if len(got) != 2 || !strings.Contains(got[0], "「背景」那段写了 6 句") || !strings.Contains(got[1], "「做了什么」那段写了 7 句") {
		t.Fatalf("lengthProblems = %q", got)
	}
	short := "背景：外部用户说 agentm 完全不可用，要按根因修。\n四个根因都改在源头，已合进开发分支。换上新版才生效。\n要你做的：没有。\n我加的：无"
	if got := lengthProblems(short); got != nil {
		t.Fatalf("short report bounced: %q", got)
	}
	// 做了什么 written on the same line as 要你做的 is counted in its own part.
	same := "背景：修汇报。\n改好了。已上线。要你做的：没有。\n我加的：无"
	if got := lengthProblems(same); got != nil {
		t.Fatalf("same-line parts bounced: %q", got)
	}
	v := judgeExit(exitKindReport, "#1 "+long, false, func(int) bool { return true }, 0)
	if len(v.Problems) != 2 || v.Legacy {
		t.Fatalf("judgeExit = %+v", v)
	}
}
