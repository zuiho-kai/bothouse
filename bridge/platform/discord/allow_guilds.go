package discord

import "strings"

// allow_guilds limits a bot to the listed servers. The same bot token can then run in
// several projects or on several machines, each serving its own servers: messages and
// slash commands from any other server are dropped before they reach a session. Direct
// messages are served only when the list contains "dm", so two instances sharing a
// token never both answer one DM. Empty means every server and DMs (the old behaviour).
func parseAllowGuilds(opts map[string]any) map[string]bool {
	var items []string
	switch v := opts["allow_guilds"].(type) {
	case string:
		items = strings.Split(v, ",")
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok {
				items = append(items, s)
			}
		}
	case []string:
		items = v
	}
	set := map[string]bool{}
	for _, s := range items {
		if s = strings.TrimSpace(s); s != "" {
			set[s] = true
		}
	}
	if len(set) == 0 {
		return nil
	}
	return set
}

// guildAllowed reports whether an event from guildID ("" for a DM) is for this instance.
func (p *Platform) guildAllowed(guildID string) bool {
	if len(p.allowGuilds) == 0 {
		return true
	}
	if guildID == "" {
		return p.allowGuilds["dm"]
	}
	return p.allowGuilds[guildID]
}

// commandGuilds is where slash commands go: guild_id if set, else every allowed server.
func (p *Platform) commandGuilds() []string {
	if p.guildID != "" {
		return []string{p.guildID}
	}
	var out []string
	for g := range p.allowGuilds {
		if g != "dm" {
			out = append(out, g)
		}
	}
	return out
}
