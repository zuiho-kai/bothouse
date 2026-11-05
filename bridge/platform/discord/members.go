package discord

import (
	"errors"
	"log/slog"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

// Server member events (#1058; core/member_events.go). GUILD_MEMBER_ADD/REMOVE need the
// privileged Server Members Intent. A bot that asks for it without having it turned on in the
// developer portal is closed with 4014 and never connects, so the intent is only requested when
// the application flags say it is on, and a 4014 drops it for the rest of the process.

// 来源：Discord API 文档 Application Object → Application Flags（GATEWAY_GUILD_MEMBERS 1<<14，
// GATEWAY_GUILD_MEMBERS_LIMITED 1<<15），与 core/setup_remote.go 查 GATEWAY_MESSAGE_CONTENT 的写法同源。
const (
	appFlagGatewayGuildMembers        = 1 << 14 // 来源：Discord Application Flags，verified bots
	appFlagGatewayGuildMembersLimited = 1 << 15 // 来源：Discord Application Flags，未验证 bot 的开发者后台开关
	closeDisallowedIntents            = 4014    // 来源：Discord Gateway Close Event Codes「Disallowed intent(s)」
)

const (
	membersUnknown int32 = iota
	membersOn
	membersOff
)

// membersIntentFixURL: the developer-portal page with the SERVER MEMBERS INTENT toggle.
func (p *Platform) membersIntentFixURL() string {
	if p.appID == "" {
		return "https://discord.com/developers/applications"
	}
	return "https://discord.com/developers/applications/" + p.appID + "/bot"
}

// wantMembersIntent: request GuildMembers on this connect. Only when the portal toggle is on
// (application flags); a failed lookup leaves it off so the bot still connects.
func (p *Platform) wantMembersIntent(s *discordgo.Session) bool {
	if p.membersDenied.Load() {
		p.membersIntent.Store(membersOff)
		return false
	}
	app, err := s.Application("@me")
	if err != nil || app == nil {
		slog.Warn("discord: could not read application flags; member join events stay off this connect", "error", err)
		p.membersIntent.Store(membersUnknown)
		return false
	}
	if app.ID != "" {
		p.appID = app.ID
	}
	if app.Flags&(appFlagGatewayGuildMembers|appFlagGatewayGuildMembersLimited) != 0 {
		p.membersIntent.Store(membersOn)
		return true
	}
	p.membersIntent.Store(membersOff)
	return false
}

// isDisallowedIntents: Discord closed the gateway because a privileged intent is not enabled.
func isDisallowedIntents(err error) bool {
	var ce *websocket.CloseError
	return errors.As(err, &ce) && ce.Code == closeDisallowedIntents
}

// reportMembersIntent tells core, after a connect, whether member events are on.
func (p *Platform) reportMembersIntent() {
	p.mu.RLock()
	h, _ := p.lifecycleHandler.(core.MemberEventHandler)
	p.mu.RUnlock()
	if h == nil {
		return
	}
	switch p.membersIntent.Load() {
	case membersOn:
		slog.Info("discord: member join events on (Server Members Intent)", "bot", p.botName)
		h.OnMemberIntent(p.selfPlatform(), true, core.MemberIntentNotice{BotID: p.botID, BotName: p.botName})
	case membersOff:
		h.OnMemberIntent(p.selfPlatform(), false, core.MemberIntentNotice{BotID: p.botID, BotName: p.botName, FixURL: p.membersIntentFixURL()})
	}
}

// PlatformNotice implements core.PlatformNoticer (panel roles page).
func (p *Platform) PlatformNotice() string {
	if p.membersIntent.Load() != membersOff {
		return ""
	}
	return "没开 SERVER MEMBERS INTENT，新人进群收不到通知：到 Discord 开发者后台 → Bot → Privileged Gateway Intents 打开它并保存，再重启 bothouse。" + p.membersIntentFixURL()
}

func (p *Platform) handleMemberAdd(s *discordgo.Session, m *discordgo.GuildMemberAdd) {
	if m == nil || m.Member == nil {
		return
	}
	p.emitMemberEvent(s, m.Member, false)
}

func (p *Platform) handleMemberRemove(s *discordgo.Session, m *discordgo.GuildMemberRemove) {
	if m == nil || m.Member == nil {
		return
	}
	p.emitMemberEvent(s, m.Member, true)
}

func (p *Platform) emitMemberEvent(s *discordgo.Session, mem *discordgo.Member, left bool) {
	if mem.User == nil || mem.User.ID == "" || mem.User.ID == p.botID || !p.guildAllowed(mem.GuildID) {
		return
	}
	p.mu.RLock()
	h, _ := p.lifecycleHandler.(core.MemberEventHandler)
	p.mu.RUnlock()
	if h == nil {
		return
	}
	ev := core.MemberEvent{
		Left: left, GuildID: mem.GuildID, UserID: mem.User.ID, UserName: mem.User.Username,
		DisplayName: mem.Nick, Bot: mem.User.Bot,
	}
	if ev.DisplayName == "" {
		ev.DisplayName = mem.User.GlobalName
	}
	var g *discordgo.Guild
	if s != nil && s.State != nil {
		g, _ = s.State.Guild(mem.GuildID)
	}
	if g == nil && s != nil {
		g, _ = s.Guild(mem.GuildID)
	}
	if g != nil {
		ev.GuildName = g.Name
		ev.ChannelID = g.SystemChannelID
	}
	if ev.ChannelID != "" {
		ev.SessionKey = p.makeSessionKey(ev.ChannelID, p.botID)
	}
	h.OnMemberEvent(p.selfPlatform(), ev)
}
