package core

import (
	"log/slog"
	"strings"
	"time"
)

// Platform events: a general event trigger (#1058/#1060/#1061, user 11-05 「这个只是单纯的一个事件驱动
// 功能……我们只是提供一个接口和一个平台」「还有其他事件可以按力度触发，就是别人想搞什么都可以用我们这个
// 事件触发器」「他们如果没开的话，你就提醒他们去开这个权限」).
//
// A platform reports what happens on a server (someone joins, reacts, opens a channel, enters
// voice, pins…) as a PlatformEvent. The engine only publishes it: one line in events.jsonl
// (type "event") and the [[hooks]] event of the same name, which a hook can narrow to given
// servers / channels / users (HookConfig.Guilds/Channels/Users). Nothing is subscribed by default;
// no role is woken and nothing is sent. Events that need an intent the bot does not have make
// the lead tell the user, on each start, where to turn it on.

// StreamEventPlatform: one platform event (events.jsonl); data.event is the event name.
const StreamEventPlatform = "event"

// Platform event names ([[hooks]] event = "<name>"; "member.*" etc. match a group).
const (
	HookEventMemberJoined    HookEventType = "member.joined"    // someone joined a server / group
	HookEventMemberLeft      HookEventType = "member.left"      // someone left (or was removed)
	HookEventReactionAdded   HookEventType = "reaction.added"   // an emoji reaction was added to a message
	HookEventReactionRemoved HookEventType = "reaction.removed" // a reaction was taken off
	HookEventChannelCreated  HookEventType = "channel.created"  // a channel was created
	HookEventChannelDeleted  HookEventType = "channel.deleted"  // a channel was deleted
	HookEventThreadCreated   HookEventType = "thread.created"   // a thread was opened
	HookEventVoiceJoined     HookEventType = "voice.joined"     // someone entered a voice channel
	HookEventVoiceLeft       HookEventType = "voice.left"       // someone left voice
	HookEventVoiceMoved      HookEventType = "voice.moved"      // someone moved between voice channels
	HookEventPinsUpdated     HookEventType = "pins.updated"     // a message was pinned or unpinned in a channel
)

// PlatformEventNames lists every platform event, in table order (docs, tests).
var PlatformEventNames = []HookEventType{
	HookEventMemberJoined, HookEventMemberLeft, HookEventReactionAdded, HookEventReactionRemoved,
	HookEventChannelCreated, HookEventChannelDeleted, HookEventThreadCreated,
	HookEventVoiceJoined, HookEventVoiceLeft, HookEventVoiceMoved, HookEventPinsUpdated,
}

// PlatformEvent is one thing a platform saw happen. Empty fields are omitted.
type PlatformEvent struct {
	Name        HookEventType
	GuildID     string // server (Discord) / tenant-less group chat id (Feishu: the chat)
	GuildName   string
	ChannelID   string // channel the event is about (reaction / pin / thread parent / voice channel / new channel)
	ChannelName string
	UserID      string // who did it (joined, reacted, entered voice…)
	UserName    string // account name
	DisplayName string // server nickname / global name, when set
	Bot         bool   // the user is a bot
	MessageID   string // reaction.*: the message reacted to
	Emoji       string // reaction.*: the emoji (unicode, or name:id for custom)
	FromChannel string // voice.moved / voice.left: the voice channel before
	ThreadID    string // thread.created: the thread; ChannelID is its parent
	SessionKey  string // session of ChannelID, when the platform has one (passed to hooks as is)
}

// PlatformEventHandler is implemented by Engine; platforms type-assert their lifecycle handler.
type PlatformEventHandler interface {
	OnPlatformEvent(p Platform, ev PlatformEvent)
}

// PlatformEventSource: a platform that publishes platform events; the engine hands it the
// handler before Start (Discord also reaches it through its lifecycle handler).
type PlatformEventSource interface {
	SetPlatformEventHandler(h PlatformEventHandler)
}

// MemberIntentNotice: the bot connected without the member intent (it is off in the developer
// portal); FixURL is the portal page that turns it on.
type MemberIntentNotice struct {
	BotID   string
	BotName string
	FixURL  string
}

// MemberEventHandler: after each connect, whether the privileged member intent is on.
type MemberEventHandler interface {
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

func (ev PlatformEvent) data(platform string) map[string]any {
	d := map[string]any{"event": string(ev.Name), "platform": platform}
	for k, v := range map[string]string{
		"guild_id": ev.GuildID, "guild": ev.GuildName, "channel_id": ev.ChannelID, "channel": ev.ChannelName,
		"user_id": ev.UserID, "user": ev.UserName, "display_name": ev.DisplayName, "message_id": ev.MessageID,
		"emoji": ev.Emoji, "from_channel_id": ev.FromChannel, "thread_id": ev.ThreadID,
	} {
		if v != "" {
			d[k] = v
		}
	}
	if ev.Bot {
		d["bot"] = true
	}
	return d
}

func (e *Engine) OnPlatformEvent(p Platform, ev PlatformEvent) {
	if e == nil || p == nil || ev.Name == "" {
		return
	}
	data := ev.data(p.Name())
	who := platformEventLabel(ev)
	text := string(ev.Name)
	if who != "" {
		text = who + " " + text
	}
	if ev.GuildName != "" {
		text += " " + ev.GuildName
	}
	e.emitStreamEvent(StreamEventPlatform, ev.SessionKey, text, data)
	e.hooks.Emit(HookEvent{
		Event: ev.Name, Timestamp: time.Now(), SessionKey: ev.SessionKey, Platform: p.Name(),
		UserID: ev.UserID, UserName: who, GuildID: ev.GuildID, GuildName: ev.GuildName,
		ChannelID: ev.ChannelID, ChannelName: ev.ChannelName, Extra: data,
	})
	e.onMemberPlatformEvent(p, ev)
	slog.Debug("platform event", "project", e.name, "event", ev.Name, "guild", ev.GuildID, "channel", ev.ChannelID, "user", ev.UserID)
}

func platformEventLabel(ev PlatformEvent) string {
	name := ev.DisplayName
	if name == "" {
		name = ev.UserName
	}
	if ev.UserName != "" && name != ev.UserName {
		name += "（" + ev.UserName + "）"
	}
	if name == "" {
		name = ev.UserID
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
		Prompt: "[系统提醒] 你的 Discord 机器人「" + n.BotName + "」没开 SERVER MEMBERS INTENT，有人进群、退群时桥收不到，member.joined / member.left 事件不会触发（其他事件不受影响）。这不是用户发来的消息。" +
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
