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
	isBot := func(id string) bool { return id == "bot" || id == "bot2" }
	cases := []struct {
		name       string
		ows        []*discordgo.PermissionOverwrite
		selfID     string
		peerBots   []string
		canBotView func(string) bool
		want       bool
	}{
		// acerak01's workspace on agentm, 2026-11-06: @everyone deny 1024, the user and 龙娘 allowed.
		{"one person and the bot", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), member("bot")}, "bot", nil, nil, true},
		{"public channel", []*discordgo.PermissionOverwrite{member("u1")}, "bot", nil, nil, false},
		{"second person", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), member("u2"), member("bot")}, "bot", nil, nil, false},
		{"a role let in", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), {ID: "r", Type: discordgo.PermissionOverwriteTypeRole, Allow: view}}, "bot", nil, nil, false},
		{"author not let in", []*discordgo.PermissionOverwrite{everyoneDeny, member("u2"), member("bot")}, "bot", nil, nil, false},
		{"denied member ignored", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), {ID: "u2", Type: discordgo.PermissionOverwriteTypeMember, Deny: view}}, "bot", nil, nil, true},
		// Multi-bot private room: both bot and bot2 are explicitly let in -> not 1-on-1 private room.
		{"multiple bots in private room", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), member("bot"), member("bot2")}, "bot", nil, nil, false},
		// 1 other bot explicitly allowed, but current bot is bot1 -> false for bot1.
		{"only other bot allowed", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1"), member("bot2")}, "bot", nil, nil, false},
		// 0 explicit bot overwrites (e.g. admin bots): only 1 bot in process -> true.
		{"0 bot overwrite solo bot", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1")}, "bot", nil, nil, true},
		// 0 explicit bot overwrites: multiple bots in teamPlatforms and another bot can view channel -> false.
		{"0 bot overwrite multi bot visible", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1")}, "bot", []string{"bot2"}, func(id string) bool { return id == "bot2" }, false},
		// 0 explicit bot overwrites: multiple bots in teamPlatforms but other bot cannot view -> true.
		{"0 bot overwrite other bot cannot view", []*discordgo.PermissionOverwrite{everyoneDeny, member("u1")}, "bot", []string{"bot2"}, func(id string) bool { return false }, true},
	}
	for _, c := range cases {
		for _, peer := range c.peerBots {
			teamPlatforms.Store(peer, &Platform{botID: peer})
		}
		got := privateOverwrites(c.ows, "g", "u1", c.selfID, isBot, c.canBotView)
		for _, peer := range c.peerBots {
			teamPlatforms.Delete(peer)
		}
		if got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
