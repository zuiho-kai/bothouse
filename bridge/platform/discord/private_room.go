package discord

import "github.com/bwmarrin/discordgo"

// privateRoom reports whether a person's server message is in a channel only that person (and
// bots) can see, such as the one-to-one workspace a bot opens for a member: @everyone may not
// view it, no other role is let in, and every member let in is the author or a bot. Talking
// there is talking to this bot, so the gate's fallbacks answer it without an @ (user 2026-11-06:
// acerak01's own workspace with 龙娘 went unanswered while the gate had no model). A thread is
// judged by its parent channel. Unknown channels or members count as not private.
func (p *Platform) privateRoom(s *discordgo.Session, guildID, channelID, authorID string) bool {
	if guildID == "" || s == nil {
		return false
	}
	ch := p.lookupChannel(s, channelID)
	if ch != nil && ch.IsThread() && ch.ParentID != "" {
		ch = p.lookupChannel(s, ch.ParentID)
	}
	if ch == nil {
		return false
	}
	return privateOverwrites(ch.PermissionOverwrites, guildID, authorID, p.selfID(), func(id string) bool {
		return p.isBotUser(s, guildID, id)
	}, func(userID string) bool {
		return p.userCanViewChannel(s, ch, userID)
	})
}

// userCanViewChannel checks if a user has ViewChannel permission in ch.
// It checks s.State.UserChannelPermissions if available, or session API, or falls back.
func (p *Platform) userCanViewChannel(s *discordgo.Session, ch *discordgo.Channel, userID string) bool {
	if s == nil || ch == nil || userID == "" {
		return false
	}
	const view = int64(discordgo.PermissionViewChannel)
	if s.State != nil {
		if perms, err := s.State.UserChannelPermissions(userID, ch.ID); err == nil {
			return perms&view != 0
		}
	}
	if perms, err := s.UserChannelPermissions(userID, ch.ID); err == nil {
		return perms&view != 0
	}
	return false
}

func privateOverwrites(
	ows []*discordgo.PermissionOverwrite,
	guildID, authorID, selfID string,
	isBot func(string) bool,
	canBotView ...func(string) bool,
) bool {
	const view = int64(discordgo.PermissionViewChannel)
	hidden, author := false, false
	var allowedBotID string
	botsCount := 0
	for _, o := range ows {
		if o == nil {
			continue
		}
		switch {
		case o.Type == discordgo.PermissionOverwriteTypeRole && o.ID == guildID:
			hidden = o.Deny&view != 0
		case o.Allow&view == 0:
		case o.Type == discordgo.PermissionOverwriteTypeRole:
			return false // a role is let in: more than one person may read it
		case o.ID == authorID:
			author = true
		case isBot(o.ID):
			botsCount++
			allowedBotID = o.ID
		default:
			return false
		}
	}
	if !hidden || !author {
		return false
	}
	// Case 1: overwrites explicitly name multiple bots -> not a 1-on-1 private room.
	if botsCount > 1 {
		return false
	}
	// Case 2: overwrites explicitly allow exactly 1 bot, but it's a different bot -> not this bot's room.
	if botsCount == 1 {
		return selfID == "" || allowedBotID == selfID
	}
	// Case 3: botsCount == 0: no bot has an explicit allow overwrite (e.g. bots have Admin/Guild view permissions).
	// If teamPlatforms has multiple bots or another bot can view this channel, it is not a 1-on-1 private room.
	var checker func(string) bool
	if len(canBotView) > 0 && canBotView[0] != nil {
		checker = canBotView[0]
	}
	peerBotsCanView := 0
	teamPlatforms.Range(func(key, val any) bool {
		botID, ok := key.(string)
		if !ok || botID == selfID {
			return true
		}
		if checker != nil {
			if checker(botID) {
				peerBotsCanView++
			}
		} else {
			peerBotsCanView++
		}
		return true
	})
	return peerBotsCanView == 0
}

func (p *Platform) lookupChannel(s *discordgo.Session, id string) *discordgo.Channel {
	if s.State != nil {
		if ch, err := s.State.Channel(id); err == nil && ch != nil {
			return ch
		}
	}
	if ch, err := s.Channel(id); err == nil {
		return ch
	}
	return nil
}

func (p *Platform) isBotUser(s *discordgo.Session, guildID, id string) bool {
	if id == p.selfID() {
		return true
	}
	if _, ok := teamPlatforms.Load(id); ok {
		return true
	}
	if s.State != nil {
		if m, err := s.State.Member(guildID, id); err == nil && m != nil && m.User != nil {
			return m.User.Bot
		}
	}
	if m, err := s.GuildMember(guildID, id); err == nil && m != nil && m.User != nil {
		return m.User.Bot
	}
	return false
}
