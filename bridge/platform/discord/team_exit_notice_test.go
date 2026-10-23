package discord

import "testing"

// #139 C: a workspace ask/report forwarded into the chat channel is a visible
// record only. It starts with 📬, so every teammate bot drops it before any
// turn or listen-only context (core/team_exit.go).
func TestForwardedWorkspaceExitWakesNoBot(t *testing.T) {
	for _, s := range []string{
		"📬 来自工作区 <#1> 的「橘」的提问（直接回复这条就能答复，编号 ask-0011aabb）：\n用 A 还是 B？",
		"📬 来自工作区 <#1> 的「橘」的阶段结果：\n第一阶段做完",
		"📬（续 ask-0011aabb）\n下文",
		"📬 瑞凤 在聊天频道 <#2> 回复了「橘」的提问 ask-0011aabb：\n用 A",
	} {
		if !isBotNotice(s) {
			t.Fatalf("forwarded exit would reach bots: %q", s)
		}
	}
}
