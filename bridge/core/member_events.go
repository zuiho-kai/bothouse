package core

import (
	"log/slog"
	"strings"
	"time"
)

// Server member events (#1058/#1060, user 11-05 「这个只是单纯的一个事件驱动功能，别人愿意搞什么欢迎
// 别人愿意搞什么……我们只是提供一个接口和一个平台」「他们如果没开的话，你就提醒他们去开这个权限」).
//
// A platform that sees people join or leave a server (Discord GUILD_MEMBER_ADD/REMOVE, which
// needs the privileged Server Members Intent) reports it through MemberEventHandler. The
// engine only publishes it: one line in events.jsonl and the [[hooks]] events member.joined /
// member.left (user id, name, server, time). It wakes no role and sends nothing; what to do
// with a newcomer is up to whoever subscribes. A bot without the intent connects as before and
// the lead tells the user, on each start, where to turn it on.

// StreamEventMember: one member joined or left a server (events.jsonl).
const StreamEventMember = "member"

// MemberEvent is one join or leave seen by a platform.
type MemberEvent struct {
	Left        bool   // false: joined; true: left
	GuildID     string // server id
	GuildName   string
	UserID      string
	UserName    string // account name
	DisplayName string // server nickname / global name, when set
	Bot         bool
	// ChannelID / SessionKey: the server's system channel, when it has one (passed to hooks as is).
	ChannelID  string
	SessionKey string
}

// MemberIntentNotice: the bot connected without the member intent (it is off in the developer
// portal); FixURL is the portal page that turns it on.
type MemberIntentNotice struct {
	BotID   string
	BotName string
	FixURL  string
}

// MemberEventHandler is implemented by Engine; platforms type-assert their lifecycle handler.
type MemberEventHandler interface {
	OnMemberEvent(p Platform, ev MemberEvent)
	// OnMemberIntent reports, after each connect, whether member events are on.
	OnMemberIntent(p Platform, on bool, n MemberIntentNotice)
}

// PlatformNoticer: a platform with something the user must fix (shown in the panel's roles page).
type PlatformNoticer interface {
	PlatformNotice() string
}

// memberNoticeTarget: this engine tells the user about a missing intent (team lead, or no team).
func (e *Engine) memberNoticeTarget() bool {
	return e.team == nil || e.isTeamLead()
}

// Hook event names for member joins/leaves.
const (
	HookEventMemberJoined HookEventType = "member.joined"
	HookEventMemberLeft   HookEventType = "member.left"
)

func (e *Engine) OnMemberEvent(p Platform, ev MemberEvent) {
	if e == nil || p == nil || ev.UserID == "" {
		return
	}
	verb, hookEv := "joined", HookEventMemberJoined
	if ev.Left {
		verb, hookEv = "left", HookEventMemberLeft
	}
	now := time.Now()
	who := memberLabel(ev)
	data := map[string]any{
		"platform": p.Name(), "action": verb, "guild_id": ev.GuildID, "guild": ev.GuildName,
		"user_id": ev.UserID, "user": ev.UserName, "display_name": ev.DisplayName, "bot": ev.Bot,
		"channel_id": ev.ChannelID,
	}
	e.emitStreamEvent(StreamEventMember, ev.SessionKey, who+" "+verb+" "+ev.GuildName, data)
	e.hooks.Emit(HookEvent{
		Event: hookEv, Timestamp: now, SessionKey: ev.SessionKey, Platform: p.Name(),
		UserID: ev.UserID, UserName: who, Extra: data,
	})
	slog.Info("member event", "project", e.name, "guild", ev.GuildID, "user", ev.UserID, "action", verb)
}

func memberLabel(ev MemberEvent) string {
	name := ev.DisplayName
	if name == "" {
		name = ev.UserName
	}
	if ev.UserName != "" && name != ev.UserName {
		name += "（" + ev.UserName + "）"
	}
	return name
}

// ── member intent off: tell the user once ──────────────────────────

func (e *Engine) OnMemberIntent(p Platform, on bool, n MemberIntentNotice) {
	if e == nil || p == nil {
		return
	}
	if on {
		return
	}
	slog.Warn("discord: Server Members Intent is off; member.joined / member.left will not fire",
		"project", e.name, "bot", n.BotName, "fix", "Developer Portal → Bot → Privileged Gateway Intents → SERVER MEMBERS INTENT", "url", n.FixURL)
	if !e.memberNoticeTarget() || e.timerScheduler == nil {
		return
	}
	chat := ""
	prefix := p.Name() + ":"
	for _, c := range e.teamLeadChats() {
		if strings.HasPrefix(c, prefix) {
			if _, isWS := e.workspaceOwner(strings.TrimPrefix(c, prefix)); !isWS {
				chat = c
				break
			}
		}
	}
	if chat == "" {
		return // no channel yet; the log line and the panel carry it
	}
	silent := true
	job := &TimerJob{
		ID:          GenerateTimerID(),
		Project:     e.name,
		SessionKey:  chat,
		ScheduledAt: time.Now(),
		Prompt: "[系统提醒] 你的 Discord 机器人「" + n.BotName + "」没开 SERVER MEMBERS INTENT，有人进群、退群时桥收不到，member.joined / member.left 事件不会触发。这不是用户发来的消息。" +
			"在本频道用一两句话告诉用户：打开 " + n.FixURL + "（Discord 开发者后台 → Bot），在 Privileged Gateway Intents 里打开 SERVER MEMBERS INTENT 并保存，然后重启 bothouse；不开也不影响平时聊天，只是没有进群事件。",
		Description:   "提醒打开成员权限",
		Silent:        &silent,
		WaitUserQuiet: true,
		CreatedAt:     time.Now(),
	}
	if err := e.timerScheduler.AddJob(job); err != nil {
		slog.Error("member intent: queue notice failed", "project", e.name, "error", err)
	}
}
