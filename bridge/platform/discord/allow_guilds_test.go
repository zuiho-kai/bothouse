package discord

import "testing"

func TestGuildAllowed(t *testing.T) {
	p := &Platform{}
	if !p.guildAllowed("g1") || !p.guildAllowed("") {
		t.Fatal("empty allow_guilds must serve every server and DMs")
	}
	p.allowGuilds = parseAllowGuilds(map[string]any{"allow_guilds": " g1, g2 "})
	if !p.guildAllowed("g1") || !p.guildAllowed("g2") || p.guildAllowed("g3") || !p.guildAllowed("") {
		t.Fatalf("string list: %v", p.allowGuilds)
	}
	p.allowGuilds = parseAllowGuilds(map[string]any{"allow_guilds": []any{"g1", "dm"}})
	if !p.guildAllowed("") || p.guildAllowed("g2") {
		t.Fatalf("array list with dm: %v", p.allowGuilds)
	}
	if got := p.commandGuilds(); len(got) != 1 || got[0] != "g1" {
		t.Fatalf("commandGuilds = %v", got)
	}
	p.allowGuilds = parseAllowGuilds(map[string]any{"allow_guilds": "g1,-dm"})
	if p.guildAllowed("") || !p.guildAllowed("g1") || p.guildAllowed("g2") {
		t.Fatalf("-dm turns DMs off: %v", p.allowGuilds)
	}
	p.allowGuilds = parseAllowGuilds(map[string]any{"allow_guilds": "nodm"})
	if p.guildAllowed("") || !p.guildAllowed("g9") {
		t.Fatalf("only nodm: every server, no DMs: %v", p.allowGuilds)
	}
}

func TestGuildAllowedDMOncePerToken(t *testing.T) {
	a := &Platform{botID: "dupbot"}
	b := &Platform{botID: "dupbot"}
	teamPlatforms.Store("dupbot", a)
	t.Cleanup(func() { teamPlatforms.Delete("dupbot") })
	if !a.guildAllowed("") || b.guildAllowed("") {
		t.Fatal("two instances of one token: only the registered one answers a DM")
	}
	if !b.guildAllowed("g1") {
		t.Fatal("servers are not deduped here")
	}
}
