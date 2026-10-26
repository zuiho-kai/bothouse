package discord

import (
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

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

// The 📬 prefix is not the only guard. Through the real gateway entrypoint, a
// forwarded record from an allowed teammate bot is dropped; and if the prefix
// were lost, the escaped mention (core quietText inserts U+200B after "@") no
// longer counts as <@me>, so the message is listen-only context (Mentioned=false,
// core/gate.go never starts a turn from an unmentioned bot message).
func TestForwardedWorkspaceExitGatewayWakesNoBot(t *testing.T) {
	quiet := "<@​200> 看一下" // what core.quietText makes of "<@200> 看一下"
	for _, tc := range []struct {
		name, content string
		wantDelivered bool
	}{
		{"with_prefix", "📬 来自工作区 <#1> 的「橘」的提问（直接回复这条就能答复，编号 ask-0011aabb）：\n" + quiet, false},
		{"answer_back", "📬 瑞凤 在聊天频道 <#2> 回复了「橘」的提问 ask-0011aabb：\n" + quiet, false},
		{"prefix_lost", "来自工作区 <#1> 的「橘」的阶段结果：\n" + quiet, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, replyAll := range []bool{false, true} {
				var delivered []*core.Message
				p := &Platform{botID: "200", botName: "200", allowFrom: "*", allowBots: "100"}
				if replyAll {
					p.groupReplyAllGuilds = []string{"*"}
				}
				p.botRoleIDs.Store("guild", "role-200")
				p.channelNameCache.Store("chat", "chat")
				p.handler = func(_ core.Platform, msg *core.Message) { delivered = append(delivered, msg) }
				t.Cleanup(func() { stopBotBursts(p) })
				p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{
					ID: "fwd-" + tc.name, GuildID: "guild", ChannelID: "chat",
					Author: &discordgo.User{ID: "100", Bot: true}, Timestamp: time.Now(), Content: tc.content,
				}})
				for _, m := range delivered {
					if m.Mentioned || !m.FromBot {
						t.Fatalf("replyAll=%v: forwarded record would start a turn: %+v", replyAll, m)
					}
				}
				if !tc.wantDelivered && len(delivered) != 0 {
					t.Fatalf("replyAll=%v: 📬 record reached the bot: %d", replyAll, len(delivered))
				}
			}
		})
	}
}
