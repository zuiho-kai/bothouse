package discord

import "fmt"

// lead returns the configured team_lead_bot; ReloadOptions may change it while running.
func (p *Platform) lead() string {
	p.liveMu.RLock()
	defer p.liveMu.RUnlock()
	return p.teamLead
}

func (p *Platform) allowBotsCSV() string {
	p.liveMu.RLock()
	defer p.liveMu.RUnlock()
	return p.allowBots
}

// ReloadOptions applies the options from config.toml that a running bot can take without
// reconnecting: allow_bots and team_lead_bot (the setup wizard rewrites both on existing roles when
// a role is added). It returns the keys that differ from what the bot started with but only take
// effect after a restart.
func (p *Platform) ReloadOptions(opts map[string]any) []string {
	allow, _ := opts["allow_bots"].(string)
	lead, _ := opts["team_lead_bot"].(string)
	p.liveMu.Lock()
	p.allowBots, p.teamLead = allow, lead
	p.liveMu.Unlock()

	var restart []string
	share, _ := opts["share_session_in_channel"].(bool)
	if share != p.shareSessionInChannel {
		restart = append(restart, "share_session_in_channel")
	}
	// group_reply_all and its guild/channel lists are parsed once in New; any change waits for a restart
	if fmt.Sprint(opts["group_reply_all"]) != fmt.Sprint(p.startGroupReplyAll) {
		restart = append(restart, "group_reply_all")
	}
	return restart
}

// BotAllowed reports whether messages from bot id get through (allow_bots or allow_bots_file).
func (p *Platform) BotAllowed(id string) bool { return p.botAllowed(id) }
