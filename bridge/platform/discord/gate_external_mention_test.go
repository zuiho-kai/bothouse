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
		{"human", "<@222> help", false, false},
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
