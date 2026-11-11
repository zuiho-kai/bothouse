package discord

import (
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// #1434: an external Discord bot need not run inside this bridge.
func TestGateExternalBotMentionCarriesAddressee(t *testing.T) {
	for _, tc := range []struct {
		name, content string
		bot           bool
		want          bool
	}{
		{"external_bot", "<@222> help", true, true},
		{"external_bot_nickname", "<@!222> help", true, true},
		{"human", "<@222> help", false, true}, // #1453: @ a person calls someone else too
		{"notification_only", "hello", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &Platform{botID: "111", botName: "Lead", allowFrom: "*", groupReplyAllGuilds: []string{"guild"}}
			p.botRoleIDs.Store("guild", "role-111")
			p.channelNameCache.Store("channel", "test")
			var got *core.Message
			p.handler = func(_ core.Platform, msg *core.Message) { got = msg }
			p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{
				ID: tc.name, GuildID: "guild", ChannelID: "channel",
				Author: &discordgo.User{ID: "human"}, Timestamp: time.Now(),
				Content: tc.content, Mentions: []*discordgo.User{{ID: "222", Bot: tc.bot}},
			}})
			if got == nil || got.AddressedOther != tc.want {
				t.Fatalf("delivered = %+v, want addressed_other=%v", got, tc.want)
			}
		})
	}
}

// #1453: the platform's one fact about calling someone else, for every way a person can do it.
func TestCallsOtherTable(t *testing.T) {
	ref := func(id string, bot bool) *discordgo.Message {
		return &discordgo.Message{ID: "r", Author: &discordgo.User{ID: id, Bot: bot}}
	}
	for _, tc := range []struct {
		name    string
		content string
		ref     *discordgo.Message
		want    bool
	}{
		{"@本角色", "<@111> 看看", nil, false},
		{"@本角色的身份组", "<@&role-111> 看看", nil, false},
		{"@队友bot", "<@222> 看看", nil, true},
		{"@真人", "<@887952333957386250> PTAL", nil, true},
		{"@别的身份组", "<@&555> 看看", nil, true},
		{"回复本角色", "可以", ref("111", true), false},
		{"回复别的真人", "可以", ref("333", false), true},
		{"回复自己的消息", "补一句", ref("human", false), false},
		{"谁都没叫", "大家好", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &discordgo.MessageCreate{Message: &discordgo.Message{
				GuildID: "guild", ChannelID: "channel", Author: &discordgo.User{ID: "human"},
				Content: tc.content, ReferencedMessage: tc.ref,
			}}
			if tc.ref != nil {
				m.Type = discordgo.MessageTypeReply
			}
			if got := callsOther(m, "111", "role-111"); got != tc.want {
				t.Fatalf("callsOther = %v, want %v", got, tc.want)
			}
		})
	}
}
