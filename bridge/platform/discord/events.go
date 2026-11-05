package discord

import (
	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// Platform events (#1061; core/member_events.go): what happens on a server goes to core as a
// core.PlatformEvent, which only publishes it (events.jsonl + [[hooks]]). The bot's own actions
// and servers outside allow_guilds are skipped.

func (p *Platform) addEventHandlers(s *discordgo.Session) {
	s.AddHandler(p.handleReactionAdd)
	s.AddHandler(p.handleReactionRemove)
	s.AddHandler(p.handleChannelCreate)
	s.AddHandler(p.handleChannelDelete)
	s.AddHandler(p.handleThreadCreate)
	s.AddHandler(p.handleVoiceState)
	s.AddHandler(p.handlePinsUpdate)
}

// emitEvent fills server / channel names from the state cache and hands the event to core.
func (p *Platform) emitEvent(s *discordgo.Session, ev core.PlatformEvent) {
	if (ev.UserID != "" && ev.UserID == p.botID) || !p.guildAllowed(ev.GuildID) {
		return
	}
	p.mu.RLock()
	h, _ := p.lifecycleHandler.(core.PlatformEventHandler)
	p.mu.RUnlock()
	if h == nil {
		return
	}
	if s != nil && s.State != nil {
		if ev.GuildName == "" && ev.GuildID != "" {
			if g, err := s.State.Guild(ev.GuildID); err == nil && g != nil {
				ev.GuildName = g.Name
			}
		}
		if ev.ChannelName == "" && ev.ChannelID != "" {
			if c, err := s.State.Channel(ev.ChannelID); err == nil && c != nil {
				ev.ChannelName = c.Name
			}
		}
	}
	if ev.SessionKey == "" && ev.ChannelID != "" {
		ev.SessionKey = p.makeSessionKey(ev.ChannelID, p.botID)
	}
	h.OnPlatformEvent(p.selfPlatform(), ev)
}

func withMember(ev core.PlatformEvent, m *discordgo.Member) core.PlatformEvent {
	if m == nil {
		return ev
	}
	ev.DisplayName = m.Nick
	if u := m.User; u != nil {
		if ev.UserID == "" {
			ev.UserID = u.ID
		}
		ev.UserName = u.Username
		ev.Bot = u.Bot
		if ev.DisplayName == "" {
			ev.DisplayName = u.GlobalName
		}
	}
	return ev
}

func (p *Platform) handleMemberAdd(s *discordgo.Session, m *discordgo.GuildMemberAdd) {
	if m == nil || m.Member == nil || m.User == nil {
		return
	}
	p.emitMember(s, m.Member, core.HookEventMemberJoined)
}

func (p *Platform) handleMemberRemove(s *discordgo.Session, m *discordgo.GuildMemberRemove) {
	if m == nil || m.Member == nil || m.User == nil {
		return
	}
	p.emitMember(s, m.Member, core.HookEventMemberLeft)
}

func (p *Platform) emitMember(s *discordgo.Session, mem *discordgo.Member, name core.HookEventType) {
	ev := withMember(core.PlatformEvent{Name: name, GuildID: mem.GuildID}, mem)
	var g *discordgo.Guild
	if s != nil && s.State != nil {
		g, _ = s.State.Guild(mem.GuildID)
	}
	if g == nil && s != nil && s.Token != "" {
		g, _ = s.Guild(mem.GuildID)
	}
	if g != nil {
		ev.GuildName = g.Name
		ev.ChannelID = g.SystemChannelID // the server's system channel, when set
	}
	p.emitEvent(s, ev)
}

func emojiString(e discordgo.Emoji) string {
	if e.ID == "" {
		return e.Name
	}
	return e.Name + ":" + e.ID
}

func (p *Platform) handleReactionAdd(s *discordgo.Session, r *discordgo.MessageReactionAdd) {
	if r == nil || r.MessageReaction == nil {
		return
	}
	ev := withMember(core.PlatformEvent{Name: core.HookEventReactionAdded, GuildID: r.GuildID, ChannelID: r.ChannelID,
		UserID: r.UserID, MessageID: r.MessageID, Emoji: emojiString(r.Emoji)}, r.Member)
	p.emitEvent(s, ev)
}

func (p *Platform) handleReactionRemove(s *discordgo.Session, r *discordgo.MessageReactionRemove) {
	if r == nil || r.MessageReaction == nil {
		return
	}
	p.emitEvent(s, core.PlatformEvent{Name: core.HookEventReactionRemoved, GuildID: r.GuildID, ChannelID: r.ChannelID,
		UserID: r.UserID, MessageID: r.MessageID, Emoji: emojiString(r.Emoji)})
}

func (p *Platform) handleChannelCreate(s *discordgo.Session, c *discordgo.ChannelCreate) {
	if c == nil || c.Channel == nil || c.GuildID == "" {
		return
	}
	p.emitEvent(s, core.PlatformEvent{Name: core.HookEventChannelCreated, GuildID: c.GuildID, ChannelID: c.ID, ChannelName: c.Name})
}

func (p *Platform) handleChannelDelete(s *discordgo.Session, c *discordgo.ChannelDelete) {
	if c == nil || c.Channel == nil || c.GuildID == "" {
		return
	}
	// the state cache has already dropped it: the name comes from the event
	p.emitEvent(s, core.PlatformEvent{Name: core.HookEventChannelDeleted, GuildID: c.GuildID, ChannelID: c.ID, ChannelName: c.Name})
}

func (p *Platform) handleThreadCreate(s *discordgo.Session, t *discordgo.ThreadCreate) {
	if t == nil || t.Channel == nil || !t.NewlyCreated {
		return // also sent when the bot is added to an existing thread
	}
	p.emitEvent(s, core.PlatformEvent{Name: core.HookEventThreadCreated, GuildID: t.GuildID, ChannelID: t.ParentID,
		ThreadID: t.ID, UserID: t.OwnerID})
}

func (p *Platform) handleVoiceState(s *discordgo.Session, v *discordgo.VoiceStateUpdate) {
	if v == nil || v.VoiceState == nil {
		return
	}
	before := ""
	if v.BeforeUpdate != nil {
		before = v.BeforeUpdate.ChannelID
	}
	ev := core.PlatformEvent{GuildID: v.GuildID, UserID: v.UserID, ChannelID: v.ChannelID, FromChannel: before}
	switch {
	case before == "" && v.ChannelID != "":
		ev.Name = core.HookEventVoiceJoined
	case before != "" && v.ChannelID == "":
		ev.Name, ev.ChannelID = core.HookEventVoiceLeft, before
	case before != "" && v.ChannelID != before:
		ev.Name = core.HookEventVoiceMoved
	default:
		return // mute / deafen / stream toggles
	}
	p.emitEvent(s, withMember(ev, v.Member))
}

func (p *Platform) handlePinsUpdate(s *discordgo.Session, u *discordgo.ChannelPinsUpdate) {
	if u == nil || u.GuildID == "" {
		return
	}
	p.emitEvent(s, core.PlatformEvent{Name: core.HookEventPinsUpdated, GuildID: u.GuildID, ChannelID: u.ChannelID})
}
