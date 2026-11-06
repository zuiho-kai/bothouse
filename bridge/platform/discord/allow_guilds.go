package discord

import "strings"

// allow_guilds limits a bot to the listed servers. The same bot token can then run in
// several projects or on several machines, each serving its own servers: messages and
// slash commands from any other server are dropped before they reach a session. Direct
// messages are always served (a DM is the most basic way to reach a bot; user 2026-11-06
// 「这个都是基本常识能力」): write "-dm" in the list to turn them off. Several instances of one
// token in this process answer a DM once (the instance registered for the bot id); on several
// machines, keep "-dm" on all but one. Empty means every server and DMs.
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

// isDMMarker: "dm" (old way to keep DMs, now the default) and "-dm"/"nodm" (turn DMs off)
// are not server ids.
func isDMMarker(s string) bool { return s == "dm" || s == "-dm" || s == "nodm" }

// guildAllowed reports whether an event from guildID ("" for a DM) is for this instance.
func (p *Platform) guildAllowed(guildID string) bool {
	if guildID == "" {
		if p.allowGuilds["-dm"] || p.allowGuilds["nodm"] {
			return false
		}
		// Same token twice in one process: only the instance registered for the bot id answers.
		if p.botID != "" {
			if v, ok := teamPlatforms.Load(p.botID); ok && v != p {
				return false
			}
		}
		return true
	}
	servers := false
	for g := range p.allowGuilds {
		if !isDMMarker(g) {
			servers = true
			break
		}
	}
	return !servers || p.allowGuilds[guildID]
}

// commandGuilds is where slash commands go: guild_id if set, else every allowed server.
func (p *Platform) commandGuilds() []string {
	if p.guildID != "" {
		return []string{p.guildID}
	}
	var out []string
	for g := range p.allowGuilds {
		if !isDMMarker(g) {
			out = append(out, g)
		}
	}
	return out
}
