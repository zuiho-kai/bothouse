package core

import (
	"log/slog"
	"sync"
	"time"
)

// Addressee is who a message calls, as far as this role is concerned.
type Addressee int

const (
	// AddrNone: the message calls no one (plain chat in a group).
	AddrNone Addressee = iota
	// AddrSelf: the message calls this role (@, reply to it, its name at a line start, a private
	// chat, or a workspace channel it runs).
	AddrSelf
	// AddrOther: the message calls someone else — another bot or a person — and not this role.
	AddrOther
)

func (a Addressee) String() string {
	switch a {
	case AddrSelf:
		return "self"
	case AddrOther:
		return "other"
	}
	return "none"
}

// addresseeOf is the one place the bridge decides whom a message calls (user 2026-11-11
// 「能不能修根因感觉还在修现象」: the gate path, the no-gate fallback and the platforms each had
// their own rule, and fixing one branch left the next one taking messages meant for others).
// Everything that routes a message — the gate path, the no-gate path, stop handling and the
// system notices — reads this result instead of looking at the message flags itself:
//   - AddrOther: no role starts, queues or acknowledges it; it is only context.
//   - AddrNone: the routing model (gate) decides; without one, no team role starts on it.
//   - AddrSelf: this role answers.
//
// The platform supplies the raw facts: Mentioned (this bot was @-ed, replied to or named at a
// line start), AddressedOther (another bot or a person was @-ed, replied to or named), Direct and
// PrivateRoom. A message that calls this role and someone else calls this role.
func (e *Engine) addresseeOf(p Platform, msg *Message) Addressee {
	switch {
	case msg.Mentioned:
		return AddrSelf
	case msg.FromBot:
		return AddrOther // a teammate talking to someone else: never starts a turn here
	case msg.Direct || msg.PrivateRoom:
		return AddrSelf
	case msg.AddressedOther:
		return AddrOther
	case e.runsWorkspaceChannel(p, msg):
		return AddrSelf
	}
	return AddrNone
}

// runsWorkspaceChannel: msg is in a team workspace channel and this role is the team's lead, the
// one work there is handed back and forth with without an @.
func (e *Engine) runsWorkspaceChannel(p Platform, msg *Message) bool {
	ch := msg.ChannelID
	if ch == "" {
		ch = sessionChannel(msg.SessionKey)
	}
	if _, ws := e.workspaceOwner(ch); !ws {
		return false
	}
	inTeam, lead := e.teamRole(p)
	return inTeam && lead
}

// teamRole reports whether this role belongs to a team (a team_lead_bot is configured) and
// whether it is that team's lead right now (a lead picked later in lead.json wins over the
// configured one).
func (e *Engine) teamRole(p Platform) (inTeam, lead bool) {
	configured, ok := p.(ConfiguredTeamLead)
	if !ok || !configured.HasConfiguredTeamLead() {
		return false, false
	}
	if e.team != nil {
		return true, e.isTeamLead()
	}
	self, ok := p.(ConfiguredTeamLeadSelf)
	if !ok {
		return false, false
	}
	if selected, ok := e.selectedTeamLead(); ok {
		return true, selected == e.name
	}
	return true, self.IsConfiguredTeamLead()
}

// suppressUnaddressedGroup is the no-gate path's reading of addresseeOf: true means the message
// must not start, queue or acknowledge a turn here.
func (e *Engine) suppressUnaddressedGroup(p Platform, msg *Message) bool {
	switch addr := e.addresseeOf(p, msg); addr {
	case AddrSelf:
		e.noteCalled(msg.SessionKey)
		return false
	case AddrOther:
		slog.Info("team: message calls someone else; listening only",
			"session", msg.SessionKey, "project", e.name)
		return true
	}
	// Calls no one. A team without a routing model has nothing that can tell a message meant
	// for the lead from people talking among themselves, so no role starts on it (user
	// 2026-11-11「路由模型没开…理论上他不应该去接 除非被艾特」). A bot that is not in a team keeps
	// answering as before.
	if inTeam, _ := e.teamRole(p); inTeam {
		slog.Info("team: no routing model, group message calls no one here; listening only",
			"session", msg.SessionKey, "project", e.name)
		return true
	}
	return false
}

// calledRecent is how long after being called in a session a role's ♻️ new-session notice still
// belongs in that chat.
const calledRecent = 30 * time.Minute

type calledLog struct {
	mu sync.Mutex
	at map[string]time.Time
}

var calledSessions = &calledLog{at: map[string]time.Time{}}

func calledKey(project, sessionKey string) string { return project + "\x00" + sessionKey }

// noteCalled records that a message calling this role arrived in sessionKey.
func (e *Engine) noteCalled(sessionKey string) {
	calledSessions.mu.Lock()
	calledSessions.at[calledKey(e.name, sessionKey)] = time.Now()
	calledSessions.mu.Unlock()
}

func (e *Engine) calledLately(sessionKey string) bool {
	calledSessions.mu.Lock()
	t, ok := calledSessions.at[calledKey(e.name, sessionKey)]
	calledSessions.mu.Unlock()
	return ok && time.Since(t) < calledRecent
}

// freshNoticeBelongs decides, from the same addressee result, whether a ♻️ new-session notice
// may be posted into a chat: a team role that was not called there lately and does not run the
// chat (the lead, or a workspace it works in) keeps it out. A teammate asked by the system to
// check a handed-back task posted 「♻️ 空闲 16.0 小时…开新会话」 into a channel it had no work in
// (agentm #vllm-omni, 11-11); its verdict is posted for it, so the notice was the only trace.
func (e *Engine) freshNoticeBelongs(p Platform, sessionKey string) bool {
	inTeam, lead := e.teamRole(p)
	if !inTeam || lead {
		return true
	}
	if _, ws := e.workspaceOwner(sessionChannel(sessionKey)); ws {
		return true
	}
	return e.calledLately(sessionKey)
}

// sendFreshNotice posts a ♻️ new-session notice where it belongs, and only logs it elsewhere.
func (e *Engine) sendFreshNotice(p Platform, replyCtx any, sessionKey, notice string) {
	if !e.freshNoticeBelongs(p, sessionKey) {
		slog.Info("new-session notice kept out: role not called here", "project", e.name, "session", sessionKey, "notice", notice)
		return
	}
	e.sendSystemNotice(p, replyCtx, notice)
}
