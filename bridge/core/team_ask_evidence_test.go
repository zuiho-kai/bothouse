package core

import (
	"strings"
	"testing"
)

func TestAskEvidenceProblems(t *testing.T) {
	for body, want := range map[string][]string{
		"用 A 还是 B？":                                 {askMissingSelfCheck, askMissingCategory},
		"用 A 还是 B？\n类别：验收":                          {askMissingSelfCheck},
		"用 A 还是 B？\n自验：go test 通过":                  {askMissingCategory},
		"用 A 还是 B？\n自验：\n类别：":                       {askMissingSelfCheck, askMissingCategory},
		"合不合？\n自验：无需\n类别：验收":                        {askNoCheckNotExempt},
		"选哪条路？\n自验：无需\n类别：方向":                       nil,
		"要充值 20 美元\n自验：无需\n类别：花钱":                   nil,
		"看一下成片\n自验：无需\n类别：需要用户看的成品":                 nil,
		"点一下授权\n自验: 无需\n类别: 权限确认":                   nil,
		"合不合？\n自验：\n```\nok  core 1.2s\n```\n类别：验收": nil,
		"合不合？\n类别：验收\n自验：截图 /tmp/a.png":             nil,
	} {
		got := askEvidenceProblems(body)
		if strings.Join(got, "|") != strings.Join(want, "|") {
			t.Errorf("askEvidenceProblems(%q) = %q, want %q", body, got, want)
		}
	}
}

func TestWorkspaceAskWithoutEvidenceGoesBack(t *testing.T) {
	for reply, want := range map[string][]string{
		"[ask]\n用 A 还是 B？\n类别：验收":         {"缺「自验：」"},
		"[ask]\n用 A 还是 B？\n自验：go test 通过": {"缺「类别：」"},
		"[ask]\n合不合？\n自验：无需\n类别：验收":       {"「自验：无需」只限"},
	} {
		e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
		exitSay(e, p, exitWSKey, "ws1", "开工")
		inputPrompt(t, a)
		inputDone(a, reply)
		// The asking bot gets a turn telling it what to add.
		prompt := inputPrompt(t, a)
		if !strings.Contains(prompt, "系统退回了你的 [ask]") {
			t.Fatalf("bounce turn = %q", prompt)
		}
		inputWait(t, func() bool { return len(p.sentTo(exitWSKey)) >= 2 })
		ws := p.sentTo(exitWSKey)
		if len(ws) != 2 || ws[0] != reply || !strings.HasPrefix(ws[1], exitPrefix) {
			t.Fatalf("workspace = %q", ws)
		}
		for _, w := range want {
			if !strings.Contains(ws[1], w) || !strings.Contains(prompt, w) {
				t.Fatalf("bounce %q / %q lacks %q", ws[1], prompt, w)
			}
		}
		if got := p.sentTo("discord:chat1"); len(got) != 0 {
			t.Fatalf("incomplete ask reached the chat channel: %q", got)
		}
		if n := len(e.teamExit.asks); n != 0 {
			t.Fatalf("bounced ask recorded: %d", n)
		}
		inputDone(a, "好，补上")
	}
}

func TestWorkspaceAskWithEvidenceForwards(t *testing.T) {
	for _, reply := range []string{
		"[ask]\n选哪条路？\n自验：无需\n类别：方向",
		"[ask]\n要充值吗\n自验：无需\n类别：花钱",
		"[ask]\n看下成片\n自验：无需\n类别：需要用户看的成品",
		"[ask]\n点一下授权\n自验：无需\n类别：权限确认",
		"[ask]\nPR #12 合不合？\n自验：go test ./core 输出 ok\n类别：验收",
	} {
		e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
		if id := e.forwardWorkspaceExit(p, exitWSKey, reply); id == "" {
			t.Fatalf("complete ask not forwarded: %q", reply)
		}
		if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "类别：") {
			t.Fatalf("forward = %q", got)
		}
		if e.teamExit.bounces[exitWSKey] != 0 {
			t.Fatalf("complete ask bounced: %q", reply)
		}
	}
}

func TestWorkspaceReportNeedsNoEvidence(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.forwardWorkspaceExit(p, exitWSKey, "[report]\n第一阶段做完")
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "第一阶段做完") {
		t.Fatalf("report forward = %q", got)
	}
	if e.teamExit.bounces[exitWSKey] != 0 {
		t.Fatal("report bounced")
	}
}

// Only the first askBounceWakeLimit bounces in a row wake the bot; a good ask resets.
func TestAskBounceWakeLimit(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.cancel() // no posts or turns: only the counter is under test
	for i := 0; i < askBounceWakeLimit+1; i++ {
		e.forwardWorkspaceExit(p, exitWSKey, "[ask]\n问一下")
	}
	e.teamExit.mu.Lock()
	n := e.teamExit.bounces[exitWSKey]
	e.teamExit.mu.Unlock()
	if n != askBounceWakeLimit+1 {
		t.Fatalf("bounces = %d", n)
	}
	e.forwardWorkspaceExit(p, exitWSKey, "[ask]\n问一下\n自验：无需\n类别：方向")
	e.teamExit.mu.Lock()
	n = e.teamExit.bounces[exitWSKey]
	e.teamExit.mu.Unlock()
	if n != 0 {
		t.Fatalf("good ask did not reset bounces: %d", n)
	}
}
