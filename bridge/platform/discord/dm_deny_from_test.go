package discord

import (
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// dm_deny_from drops only DMs from the listed users; their server messages and
// other users' DMs still reach core, and an unset option changes nothing.
func TestDMDenyFrom(t *testing.T) {
	for _, tc := range []struct {
		name, deny, guild, author string
		want                      int
	}{
		{"listed user DM dropped", " owner , x ", "", "owner", 0},
		{"listed user in server kept", "owner", "guild", "owner", 1},
		{"other user DM kept", "owner", "", "someone", 1},
		{"unset: DM kept", "", "", "owner", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var delivered []*core.Message
			p := &Platform{botID: "100", botName: "100", allowFrom: "*", groupReplyAllGuilds: []string{"*"},
				dmDenyFrom: parseDMDenyFrom(map[string]any{"dm_deny_from": tc.deny})}
			p.botRoleIDs.Store("guild", "110")
			p.channelNameCache.Store("channel", "test")
			p.handler = func(_ core.Platform, m *core.Message) { delivered = append(delivered, m) }
			p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{
				ID: "deny-" + tc.name, GuildID: tc.guild, ChannelID: "channel", Author: &discordgo.User{ID: tc.author},
				Timestamp: time.Now(), Content: "hi"}})
			if len(delivered) != tc.want {
				t.Fatalf("delivered %d messages, want %d", len(delivered), tc.want)
			}
		})
	}
}
