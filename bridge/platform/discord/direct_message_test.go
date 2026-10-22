package discord

import (
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// A DM calls the bot: core's built-in busy rules (core/gate_local.go) treat it like an @.
func TestDirectMessageMarksDirect(t *testing.T) {
	for _, tc := range []struct {
		name, guild string
		want        bool
	}{
		{"dm", "", true},
		{"guild", "guild", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var delivered []*core.Message
			p := &Platform{botID: "100", botName: "100", allowFrom: "*", groupReplyAllGuilds: []string{"*"}}
			p.botRoleIDs.Store("guild", "110")
			p.channelNameCache.Store("channel", "test")
			p.handler = func(_ core.Platform, m *core.Message) { delivered = append(delivered, m) }
			p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{
				ID: "m1", GuildID: tc.guild, ChannelID: "channel", Author: &discordgo.User{ID: "human"},
				Timestamp: time.Now(), Content: "暂停"}})
			if len(delivered) != 1 {
				t.Fatalf("delivered %d messages, want 1", len(delivered))
			}
			if delivered[0].Direct != tc.want {
				t.Fatalf("Direct = %v, want %v", delivered[0].Direct, tc.want)
			}
		})
	}
}

// What core's built-in busy rules (core/gate_local.go) receive for a reply to this bot: Mentioned
// (the reply ping), the quote prepended, and another bot's @ kept, so "reply + @彩虹猫 暂停" is not
// a stop for this bot while "reply + 暂停" is.
func TestReplyToBotReachesCoreAsCalled(t *testing.T) {
	for _, tc := range []struct{ content, want string }{
		{"暂停", "暂停"},
		{"<@200> 暂停", "<@200> 暂停"},
		{"<@100> 暂停", "@bot100(你) 暂停"},
	} {
		var got *core.Message
		p := &Platform{botID: "100", botName: "bot100", allowFrom: "*"}
		p.botRoleIDs.Store("guild", "110")
		p.channelNameCache.Store("channel", "test")
		p.handler = func(_ core.Platform, m *core.Message) { got = m }
		p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{
			ID: "r-" + tc.content, GuildID: "guild", ChannelID: "channel", Author: &discordgo.User{ID: "human"},
			Timestamp: time.Now(), Type: discordgo.MessageTypeReply, Content: tc.content,
			MessageReference:  &discordgo.MessageReference{MessageID: "original"},
			ReferencedMessage: &discordgo.Message{Author: &discordgo.User{ID: "100", Bot: true, Username: "bot100"}, Content: "我在跑"}}})
		if got == nil || !got.Mentioned || got.Direct {
			t.Fatalf("%q: got %+v, want Mentioned and not Direct", tc.content, got)
		}
		if !strings.HasPrefix(got.Content, "[replying to ") || !strings.HasSuffix(got.Content, "]\n"+tc.want) {
			t.Errorf("%q: content = %q, want quote + %q", tc.content, got.Content, tc.want)
		}
	}
}
