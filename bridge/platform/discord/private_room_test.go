package discord

import (
	"testing"

	"github.com/bwmarrin/discordgo"
)

func TestPrivateOverwrites(t *testing.T) {
	const view = int64(discordgo.PermissionViewChannel)
	everyoneDeny := &discordgo.PermissionOverwrite{ID: "g", Type: discordgo.PermissionOverwriteTypeRole, Deny: view}
	member := func(id string) *discordgo.PermissionOverwrite {
		return &discordgo.PermissionOverwrite{ID: id, Type: discordgo.PermissionOverwriteTypeMember, Allow: 117760}
	}
	isBot := func(id string) bool { return id == "bot" }
	cases := []struct {
		name string
		ows  []*discordgo.PermissionOverwrite
		want bool
	}{
		// acerak01's workspace on agentm, 2026-11-06: @everyone deny 1024, the user and 龙娘 allowed.
		{"one person and the bot", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), member("bot")}, true},
		{"public channel", []*discordgo.PermissionOverwrite{member("u1")}, false},
		{"second person", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), member("u2"), member("bot")}, false},
		{"a role let in", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), {ID: "r", Type: discordgo.PermissionOverwriteTypeRole, Allow: view}}, false},
		{"author not let in", []*discordgo.PermissionOverwrite{everyoneDeny, member("u2"), member("bot")}, false},
		{"denied member ignored", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), {ID: "u2", Type: discordgo.PermissionOverwriteTypeMember, Deny: view}}, true},
	}
	for _, c := range cases {
		if got := privateOverwrites(c.ows, "g", "u1", isBot); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
