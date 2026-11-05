package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Server member events (#1058, user 11-05 「你先把他那边偷偷处理好一下，然后把他欠缺能力我们补齐，
// 然后更新到版本里面」「他们如果没开的话，你就提醒他们去开这个权限」).
//
// A platform that sees people join or leave a server (Discord GUILD_MEMBER_ADD/REMOVE, which
// needs the privileged Server Members Intent) reports it through MemberEventHandler. The
// engine writes it to events.jsonl and, when it is the team lead (or a bot without a team),
// queues one turn in the server's welcome channel. Nobody joining costs nothing: no poller,
// no model call. A bot without the intent connects as before and the lead tells the user once
// where to turn it on.

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
	// ChannelID / SessionKey: where the lead greets (the server's system channel); empty when
	// the server has none, then the event is only recorded.
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

// memberWakeTarget: this engine handles member events itself (team lead, or no team at all).
func (e *Engine) memberWakeTarget() bool {
	return e.team == nil || e.isTeamLead()
}

func (e *Engine) OnMemberEvent(p Platform, ev MemberEvent) {
	if e == nil || p == nil || ev.UserID == "" {
		return
	}
	verb := "joined"
	if ev.Left {
		verb = "left"
	}
	who := memberLabel(ev)
	e.emitStreamEvent(StreamEventMember, ev.SessionKey, who+" "+verb+" "+ev.GuildName, map[string]any{
		"platform": p.Name(), "action": verb, "guild_id": ev.GuildID, "guild": ev.GuildName,
		"user_id": ev.UserID, "user": ev.UserName, "display_name": ev.DisplayName, "bot": ev.Bot,
		"channel_id": ev.ChannelID,
	})
	if ev.Bot || !e.memberWakeTarget() {
		return
	}
	if ev.SessionKey == "" {
		slog.Info("member event: server has no system channel; recorded only", "project", e.name, "guild", ev.GuildID, "action", verb)
		return
	}
	if e.timerScheduler == nil {
		slog.Warn("member event: no timer scheduler; lead not woken", "project", e.name)
		return
	}
	silent := true
	job := &TimerJob{
		ID:            GenerateTimerID(),
		Project:       e.name,
		SessionKey:    ev.SessionKey,
		ScheduledAt:   time.Now(),
		Prompt:        memberEventPrompt(p.Name(), ev),
		Description:   "新成员 " + who,
		Silent:        &silent,
		WaitUserQuiet: true,
		CreatedAt:     time.Now(),
	}
	if ev.Left {
		job.Description = "成员离开 " + who
	}
	if err := e.timerScheduler.AddJob(job); err != nil {
		slog.Error("member event: queue lead turn failed", "project", e.name, "error", err)
		return
	}
	slog.Info("member event: lead woken", "project", e.name, "guild", ev.GuildID, "user", ev.UserID, "action", verb)
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

func memberEventPrompt(platform string, ev MemberEvent) string {
	who := memberLabel(ev)
	if ev.Left {
		return fmt.Sprintf("[成员事件] %s 离开了服务器「%s」（%s 用户 id %s）。这不是用户发来的消息。"+
			"要是你为这个人做过接入（建过文件夹、开过频道、挂过定时），按需要收尾；不需要做什么就只回 NO_REPLY。",
			who, ev.GuildName, platform, ev.UserID)
	}
	return fmt.Sprintf("[成员事件] 新成员 %s 刚加入服务器「%s」（%s 用户 id %s，可用 <@%s> 叫到 ta）。这不是用户发来的消息。"+
		"你是主角色，在本频道欢迎 ta，按团队的新人接入做法带 ta 上手（没有现成做法就简单介绍这里能做什么、怎么叫你）。",
		who, ev.GuildName, platform, ev.UserID, ev.UserID)
}

// ── member intent off: tell the user once ──────────────────────────

var memberIntentMu sync.Mutex

func memberIntentNoticePath(dataDir string) string {
	return filepath.Join(dataDir, "member-intent-notice.json")
}

// memberIntentMark records (told) or forgets (!told) that bot was told about the missing intent;
// it returns whether the mark changed (told: first time).
func memberIntentMark(dataDir, botID string, told bool) bool {
	if dataDir == "" || botID == "" {
		return false
	}
	memberIntentMu.Lock()
	defer memberIntentMu.Unlock()
	path := memberIntentNoticePath(dataDir)
	marks := map[string]time.Time{}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &marks)
	}
	_, had := marks[botID]
	if had == told {
		return false
	}
	if told {
		marks[botID] = time.Now()
	} else {
		delete(marks, botID)
	}
	b, _ := json.MarshalIndent(marks, "", "  ")
	if err := os.WriteFile(path, b, 0o644); err != nil {
		slog.Warn("member intent: save notice mark failed", "error", err)
	}
	return true
}

func (e *Engine) OnMemberIntent(p Platform, on bool, n MemberIntentNotice) {
	if e == nil || p == nil {
		return
	}
	if on {
		memberIntentMark(e.dataDir, n.BotID, false) // turned on: tell again if it is ever turned off
		return
	}
	slog.Warn("discord: Server Members Intent is off; new members will not wake the lead",
		"project", e.name, "bot", n.BotName, "fix", "Developer Portal → Bot → Privileged Gateway Intents → SERVER MEMBERS INTENT", "url", n.FixURL)
	if !e.memberWakeTarget() || e.timerScheduler == nil {
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
		return // no channel yet; the log line and the panel carry it, the mark is not set
	}
	if !memberIntentMark(e.dataDir, n.BotID, true) {
		return // already told
	}
	silent := true
	job := &TimerJob{
		ID:          GenerateTimerID(),
		Project:     e.name,
		SessionKey:  chat,
		ScheduledAt: time.Now(),
		Prompt: "[系统提醒] 你的 Discord 机器人「" + n.BotName + "」没开 SERVER MEMBERS INTENT，新人进群时你收不到通知，没法第一时间接待。这不是用户发来的消息。" +
			"在本频道用一两句话告诉用户：打开 " + n.FixURL + "（Discord 开发者后台 → Bot），在 Privileged Gateway Intents 里打开 SERVER MEMBERS INTENT 并保存，然后重启 bothouse；不开也不影响平时聊天。只说这一次。",
		Description:   "提醒打开成员权限",
		Silent:        &silent,
		WaitUserQuiet: true,
		CreatedAt:     time.Now(),
	}
	if err := e.timerScheduler.AddJob(job); err != nil {
		slog.Error("member intent: queue notice failed", "project", e.name, "error", err)
		memberIntentMark(e.dataDir, n.BotID, false)
	}
}
