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
	return privateOverwrites(ch.PermissionOverwrites, guildID, authorID, func(id string) bool {
		return p.isBotUser(s, guildID, id)
	})
}

func privateOverwrites(ows []*discordgo.PermissionOverwrite, guildID, authorID string, isBot func(string) bool) bool {
	const view = int64(discordgo.PermissionViewChannel)
	hidden, author := false, false
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
		case !isBot(o.ID):
			return false
		}
	}
	return hidden && author
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
	if id == p.botID {
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
