package discord

import "strings"

// dm_deny_from = "id1,id2": direct messages from these users are dropped, so
// another bridge sharing this bot token answers them alone. Server messages
// from the same users are still served.
func parseDMDenyFrom(opts map[string]any) map[string]bool {
	raw, _ := opts["dm_deny_from"].(string)
	var out map[string]bool
	for _, id := range strings.Split(raw, ",") {
		if id = strings.TrimSpace(id); id != "" {
			if out == nil {
				out = map[string]bool{}
			}
			out[id] = true
		}
	}
	return out
}

// dmDenied reports whether a message in guildID ("" = DM) from userID is skipped.
func (p *Platform) dmDenied(guildID, userID string) bool {
	return guildID == "" && p.dmDenyFrom[userID]
}
