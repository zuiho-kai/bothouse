package discord

import "strings"

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

func (p *Platform) shareInChannel() bool {
	p.liveMu.RLock()
	defer p.liveMu.RUnlock()
	return p.shareSessionInChannel
}

// replyAllLists returns group_reply_all's guilds ("*" = all) and channels. ReloadOptions replaces
// the slices, never edits them, so callers may keep using them after the lock is released.
func (p *Platform) replyAllLists() (guilds, channels []string) {
	p.liveMu.RLock()
	defer p.liveMu.RUnlock()
	return p.groupReplyAllGuilds, p.groupReplyAllChannels
}

// parseGroupReplyAll reads group_reply_all_guilds (or group_reply_all = true, meaning every guild)
// and group_reply_all_channels (the wizard's default chat channel: listening without an @ is limited
// to it; @mentions and DMs work everywhere).
func parseGroupReplyAll(opts map[string]any) (guilds, channels []string) {
	if gs, _ := opts["group_reply_all_guilds"].(string); gs != "" {
		for _, g := range strings.Split(gs, ",") {
			if g = strings.TrimSpace(g); g != "" {
				guilds = append(guilds, g)
			}
		}
	} else if all, _ := opts["group_reply_all"].(bool); all {
		guilds = []string{"*"}
	}
	if chs, _ := opts["group_reply_all_channels"].(string); chs != "" {
		for _, c := range strings.Split(chs, ",") {
			if c = strings.TrimSpace(c); c != "" {
				channels = append(channels, c)
			}
		}
	}
	return guilds, channels
}

// ReloadOptions applies the options from config.toml that a running bot can take without
// reconnecting: allow_bots, team_lead_bot, group_reply_all (with group_reply_all_guilds /
// group_reply_all_channels) and share_session_in_channel. Adding a role in the setup wizard
// rewrites these on the roles already running. The new values apply from the next message
// (share_session_in_channel only changes the session key computed for it). It returns the keys
// that changed but only take effect after a restart.
func (p *Platform) ReloadOptions(opts map[string]any) []string {
	allow, _ := opts["allow_bots"].(string)
	lead, _ := opts["team_lead_bot"].(string)
	guilds, channels := parseGroupReplyAll(opts)
	share, _ := opts["share_session_in_channel"].(bool)
	var restart []string
	p.liveMu.Lock()
	defer p.liveMu.Unlock()
	p.allowBots, p.teamLead = allow, lead
	p.groupReplyAllGuilds, p.groupReplyAllChannels = guilds, channels
	// New refuses permission_approvers without share_session_in_channel; keep the running value
	if len(p.permissionApprovers) > 0 && !share {
		if p.shareSessionInChannel {
			restart = append(restart, "share_session_in_channel")
		}
	} else {
		p.shareSessionInChannel = share
	}
	return restart
}

// BotAllowed reports whether messages from bot id get through (allow_bots or allow_bots_file).
func (p *Platform) BotAllowed(id string) bool { return p.botAllowed(id) }

// ReplyAllHere reports whether a guild message in channelID (a thread: parentID) is answered without an @.
func (p *Platform) ReplyAllHere(guildID, channelID, parentID string) bool {
	return p.replyAllHere(guildID, channelID, parentID)
}

// SessionKeyFor returns the session key a message from userID in channelID gets.
func (p *Platform) SessionKeyFor(channelID, userID string) string {
	return p.makeSessionKey(channelID, userID)
}
