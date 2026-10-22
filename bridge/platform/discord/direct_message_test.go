package discord

import (
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
