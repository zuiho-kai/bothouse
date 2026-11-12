package core

import (
	"strings"
	"testing"
)

func TestWorkspaceAskWithEvidenceForwards(t *testing.T) {
	for _, reply := range []string{
		"[ask] #7 背景：你让我做这件事。\n选哪条路？\n要你做的：没有。\n我加的：无\n自验：无需\n类别：方向",
		"[ask] #7 背景：你让我做这件事。\n要充值吗\n要你做的：没有。\n我加的：无\n自验：无需\n类别：花钱",
		"[ask] #7 背景：你让我做这件事。\n看下成片\n要你做的：没有。\n我加的：无\n自验：无需\n类别：需要用户看的成品",
		"[ask] #7 背景：你让我做这件事。\n点一下授权\n要你做的：没有。\n我加的：无\n自验：无需\n类别：权限确认",
		"[ask] #7 背景：你让我做这件事。\n这个改动合不合？\n要你做的：没有。\n我加的：无\n自验：go test ./core 输出 ok\n类别：验收",
	} {
		e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
		exitBoardItem(t, e, 7, "选方案")
		if id := e.forwardWorkspaceExit(p, exitWSKey, reply); id == "" {
			t.Fatalf("complete ask not forwarded: %q", reply)
		}
		// The parts are posted; details (自验/类别) are not (user 10-30, 2795ca4a).
		if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "要你定") || strings.Contains(got[0], "类别：") {
			t.Fatalf("forward = %q", got)
		}
		if e.teamExit.bounces[exitWSKey] != 0 {
			t.Fatalf("complete ask bounced: %q", reply)
		}
	}
}

func TestWorkspaceReportNeedsNoEvidence(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	exitBoardItem(t, e, 7, "第一阶段")
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #7 背景：你让我做这件事。\n第一阶段做完\n要你做的：没有。\n我加的：无")
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "第一阶段做完") {
		t.Fatalf("report forward = %q", got)
	}
	if e.teamExit.bounces[exitWSKey] != 0 {
		t.Fatal("report bounced")
	}
}

// Only the first exitRules.Bounce.WakeLimit bounces in a row wake the bot. The next one gets no
// repair turn, so it is forwarded with the check note and ends the run (2756def4); a good ask resets too.
func TestAskBounceWakeLimit(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	exitBoardItem(t, e, 7, "选方案")
	e.cancel() // no posts or turns: only the counter is under test
	count := func() int {
		e.teamExit.mu.Lock()
		defer e.teamExit.mu.Unlock()
		return e.teamExit.bounces[exitWSKey]
	}
	for i := 0; i < exitRules.Bounce.WakeLimit; i++ {
		e.forwardWorkspaceExit(p, exitWSKey, "[ask]\n问一下")
	}
	if n := count(); n != exitRules.Bounce.WakeLimit {
		t.Fatalf("bounces = %d", n)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[ask]\n问一下")
	if n := count(); n != 0 {
		t.Fatalf("bounce past the wake limit was not forwarded: bounces = %d", n)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[ask]\n又问")
	if n := count(); n != 1 {
		t.Fatalf("bad ask after the forward would not wake: bounces = %d", n)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[ask] #7 背景：你让我做这件事。\n选哪条路？\n要你做的：没有。\n我加的：无\n自验：无需\n类别：方向")
	if n := count(); n != 0 {
		t.Fatalf("good ask did not reset bounces: %d", n)
	}
}

// A [report] or [ask] whose 「要你做的」 hands the user a command to run or a file to place goes back
// for another route, a report too (user 11-10 「你自己搞，你忘了我跟你说的事情了么」).
func TestWorkspaceExitSelfRouteGoesBack(t *testing.T) {
	for _, reply := range []string{
		"[report] #7 背景：你让我做这件事。\n代码写完了\n要你做的：在本机终端跑一次 sudo zsh setup.sh，输一次密码。\n我加的：无",
	} {
		e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
		exitBoardItem(t, e, 7, "成员隔离")
		exitSay(e, p, exitWSKey, "ws1", "开工")
		inputPrompt(t, a)
		inputDone(a, reply)
		exitByCommand(t, e, exitWSKey, reply)
		prompt := inputPrompt(t, a)
		if !strings.Contains(prompt, "系统退回了你的") || !strings.Contains(prompt, "换路") || !strings.Contains(prompt, "终端") {
			t.Fatalf("bounce turn = %q", prompt)
		}
		if got := p.sentTo("discord:chat1"); len(got) != 0 {
			t.Fatalf("hand-off reached the chat channel: %q", got)
		}
		inputDone(a, "好，换路")
	}
}
