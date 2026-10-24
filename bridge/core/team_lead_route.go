package core

// Primary-role routing for messages no one was named in (issue #117).
//
// A multi-role team has one configured fallback lead (the wizard's fallback role) and may have
// an explicit primary role chosen later (lead.json, written by the Channels page, the gate's
// "换 X 当主角色" or the lead tool). Every role reads the same two inputs and decides on its own,
// so exactly one of them takes an unaddressed group message:
//
//   - the selected primary role takes it;
//   - when the selection is unavailable (offline or not a member), the configured fallback lead
//     takes it and says so once;
//   - without a selection the configured fallback lead takes it.
//
// Team membership is read, never written: the wizard's team file (<data dir>/gate-team.json)
// first, then the platform's team_lead_bot, then the wizard's sub gate_url (?bot=), then a team
// status board. A project none of these name is a single project and keeps its old behaviour.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// teamProjectRE: a project name as the wizard writes it (same rule as dshFallbackLead).
var teamProjectRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

// TeamSelfID is implemented by platforms that know this bot's member id on the channel host
// (cloud_web: ws_url ?bot=), which lead.json uses; the project name is used otherwise.
type TeamSelfID interface {
	TeamMemberID() string
}

// teamRoster is the wizard's team file: the fallback lead and the subs, by project name.
type teamRoster struct {
	Lead     string            // fallback lead's project
	LeadName string            // its display name
	Names    map[string]string // project → display name (lead included)
}

func (r *teamRoster) has(id string) bool {
	if r == nil {
		return false
	}
	_, ok := r.Names[id]
	return ok
}

func (r *teamRoster) name(id string) string {
	if r != nil {
		if n := r.Names[id]; n != "" {
			return n
		}
	}
	return id
}

// readTeamRoster loads <dataDir>/gate-team.json (setup_wizard.go writes it for every
// multi-role Discord or cloud_web team). nil when absent or unreadable.
func (e *Engine) readTeamRoster() *teamRoster {
	if e.dataDir == "" {
		return nil
	}
	b, err := os.ReadFile(filepath.Join(e.dataDir, gateTeamFile))
	if err != nil {
		return nil
	}
	type member struct {
		Name    string   `json:"name"`
		Aliases []string `json:"aliases"`
	}
	var raw struct {
		Lead member            `json:"lead"`
		Subs map[string]member `json:"subs"`
	}
	if json.Unmarshal(b, &raw) != nil {
		return nil
	}
	r := &teamRoster{LeadName: raw.Lead.Name, Names: map[string]string{}}
	// The wizard puts the lead's project name in its aliases (setup_wizard.go gate team).
	for _, a := range raw.Lead.Aliases {
		if a = strings.TrimSpace(a); a != "" && r.Lead == "" && teamProjectRE.MatchString(a) {
			r.Lead = a
		}
	}
	if r.Lead == "" || len(raw.Subs) == 0 {
		return nil
	}
	r.Names[r.Lead] = raw.Lead.Name
	for k, m := range raw.Subs {
		r.Names[k] = m.Name
	}
	return r
}

// teamSelfID is this role's id in lead.json: the platform's member id, else the project name.
func (e *Engine) teamSelfID(p Platform) string {
	if s, ok := p.(TeamSelfID); ok {
		if id := strings.TrimSpace(s.TeamMemberID()); id != "" {
			return id
		}
	}
	return e.name
}

// teamRole reports whether this project is a member of a multi-role team and whether it is
// the configured fallback lead. p may be nil (the engine's first platform is used).
func (e *Engine) teamRole(p Platform) (inTeam, fallbackLead bool) {
	inTeam, fallbackLead, _ = e.teamRoleFrom(p)
	return
}

// teamRoleFrom is teamRole plus boardOnly: membership is known only from a team status board
// (team_status_dir), which names no fallback lead; without a selection such a member keeps
// answering as before.
func (e *Engine) teamRoleFrom(p Platform) (inTeam, fallbackLead, boardOnly bool) {
	if p == nil && len(e.platforms) > 0 {
		p = e.platforms[0]
	}
	if r := e.readTeamRoster(); r != nil {
		self := e.name
		if p != nil {
			self = e.teamSelfID(p)
		}
		if r.has(self) || r.has(e.name) {
			return true, self == r.Lead || e.name == r.Lead, false
		}
	}
	if c, ok := p.(ConfiguredTeamLead); ok && c.HasConfiguredTeamLead() {
		if self, ok := p.(ConfiguredTeamLeadSelf); ok {
			return true, self.IsConfiguredTeamLead(), false
		}
		if e.team != nil {
			return true, e.isConfiguredBoardLead(), false
		}
	}
	if g := e.gate; g != nil && strings.HasPrefix(g.url, defaultGateURL+"?") && g.bot() != "" {
		return true, false, false // the wizard's sub gate_url
	}
	if e.team != nil {
		return true, e.isConfiguredBoardLead(), true
	}
	return false, false, false
}

// isConfiguredBoardLead: team_status_inject, the configured lead of a team status board.
func (e *Engine) isConfiguredBoardLead() bool {
	e.team.mu.Lock()
	defer e.team.mu.Unlock()
	return e.team.inject
}

// leadAvailable reports whether the selected primary role can take a message. Sources, first
// that knows: the channel host's online list sent with the message (cloud_web hub); the
// selection's team status file (<team_status_dir>/<project>.json: fresh = online, stale = gone;
// missing says nothing, since a role need not write one); the team file (a selection it does not
// name is not a member). Unknown counts as online, as in the gate.
func (e *Engine) leadAvailable(selected string, msg *Message, roster *teamRoster) bool {
	if msg != nil && msg.TeamOnline != nil {
		return slices.Contains(msg.TeamOnline, selected)
	}
	if e.team != nil && e.team.dir != "" && teamProjectRE.MatchString(selected) {
		if raw, err := os.ReadFile(filepath.Join(e.team.dir, selected+teamStatusFileExt)); err == nil {
			var f teamFile
			if json.Unmarshal(raw, &f) == nil {
				return time.Since(f.Updated) <= teamStaleAfter
			}
		}
	}
	if roster != nil {
		return roster.has(selected)
	}
	return true
}

// leadRoute is the routing decision for an unaddressed group message.
type leadRoute struct {
	decided  bool   // false: not a team member, keep the old behaviour
	answer   bool   // this role takes the message
	selected string // lead.json selection ("" = none)
	selName  string
	fallback string // the configured fallback lead's name ("" unknown)
	standIn  bool   // answering because the selection is unavailable
}

// routeUnaddressed decides whether this role takes msg, a group message from a person that
// named no one. Messages that @ this role or name a teammate are decided by the caller.
func (e *Engine) routeUnaddressed(p Platform, msg *Message) leadRoute {
	inTeam, fallback, boardOnly := e.teamRoleFrom(p)
	if !inTeam {
		return leadRoute{}
	}
	roster := e.readTeamRoster()
	r := leadRoute{decided: true}
	if roster != nil {
		r.fallback = roster.LeadName
	}
	sel, ok := e.readLeadSelection()
	if !ok {
		if boardOnly {
			return leadRoute{}
		}
		r.answer = fallback
		return r
	}
	r.selected, r.selName = sel, e.leadSelectionName(sel, roster)
	self := e.teamSelfID(p)
	if sel == self || sel == e.name {
		r.answer = true
		return r
	}
	if e.leadAvailable(sel, msg, roster) {
		return r
	}
	r.answer, r.standIn = fallback, fallback
	return r
}

// leadSelectionName is the display name of a lead.json selection: the name written next to
// it, else the team file's name, else the id.
func (e *Engine) leadSelectionName(id string, roster *teamRoster) string {
	if path := e.leadStatePath(); path != "" {
		if b, err := os.ReadFile(path); err == nil {
			var v struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(b, &v) == nil && strings.TrimSpace(v.Name) != "" {
				return strings.TrimSpace(v.Name)
			}
		}
	}
	return roster.name(id)
}

// standInNoted remembers, per session, the selection a stand-in notice was last sent for, so
// the notice goes out once per outage rather than with every message.
var standInNoted sync.Map // engine name + "\x00" + session key → selected id

// standInNotice returns the line the fallback lead posts before answering for an unavailable
// selection, or "" when it was already posted for this selection in this session.
func (e *Engine) standInNotice(sessionKey string, r leadRoute) string {
	key := e.name + "\x00" + sessionKey
	if prev, ok := standInNoted.Load(key); ok && prev == r.selected {
		return ""
	}
	standInNoted.Store(key, r.selected)
	return fmt.Sprintf("（当前选中的主角色 %s 不在线或不可用，这条由我代答）", r.selName)
}

// clearStandIn forgets the notice once the selection is available again.
func (e *Engine) clearStandIn(sessionKey string) {
	standInNoted.Delete(e.name + "\x00" + sessionKey)
}

// applyLeadRoute is the shared tail of the gate and no-gate paths for a person's group
// message that named no one: it returns false when this role must only listen, and posts the
// stand-in notice when it answers for an unavailable selection.
func (e *Engine) applyLeadRoute(p Platform, msg *Message, r leadRoute) bool {
	if !r.standIn {
		e.clearStandIn(msg.SessionKey)
		return r.answer
	}
	if r.answer {
		if note := e.standInNotice(msg.SessionKey, r); note != "" {
			e.reply(p, msg.ReplyCtx, note)
		}
	}
	return r.answer
}

// unaddressedPersonGroupMsg: a person's group message that names no member.
func unaddressedPersonGroupMsg(msg *Message) bool {
	return !msg.FromBot && !msg.Mentioned && !msg.Direct && !msg.AddressedOther
}

// leadBlock tells a team member who the primary role is, when that changed since its context
// last got it, so "谁是主角色" is answered from configuration rather than guessed.
func (e *Engine) leadBlock(session *Session) string {
	inTeam, fallback := e.teamRole(nil)
	if !inTeam {
		return ""
	}
	roster := e.readTeamRoster()
	var p Platform
	if len(e.platforms) > 0 {
		p = e.platforms[0]
	}
	self := e.name
	if p != nil {
		self = e.teamSelfID(p)
	}
	fallbackName := "（未知）"
	if roster != nil && strings.TrimSpace(roster.LeadName) != "" {
		fallbackName = roster.LeadName
	}
	you := func(is bool) string {
		if is {
			return "（就是你）"
		}
		return "（不是你）"
	}
	var text, key string
	if sel, ok := e.readLeadSelection(); ok {
		name := e.leadSelectionName(sel, roster)
		mine := sel == self || sel == e.name
		text = fmt.Sprintf("当前主角色：%s%s。没有 @ 或点名的消息由主角色接；它不在线时由兜底角色%s%s代答。人设里写的主/次分工以这条为准。",
			name, you(mine), fallbackName, you(fallback))
		key = "sel:" + sel
	} else {
		where := "频道页成员栏的「谁当主」"
		if p == nil || !strings.Contains(p.Name(), "cloud_web") {
			where = "频道页成员栏的「谁当主」，或在频道里说「换 X 当主角色」"
		}
		text = fmt.Sprintf("还没有选主角色。没有 @ 或点名的消息按配置由兜底角色%s%s接。被问到谁是主角色时如实说还没选，并提示用户在%s里选。",
			fallbackName, you(fallback), where)
		key = "none"
	}
	send := false
	session.UpdateTurnCtx(func(t *TurnCtxSent) {
		if t.Lead != key {
			t.Lead, send = key, true
		}
	})
	if !send {
		return ""
	}
	return "（主角色，系统自动附上，不用回应）\n" + text
}

// leadRouteGate adjusts a gate decision for a person's group message by the primary-role
// selection. When the gate could not answer (dec.fellBack), the static gate_fallback (the
// wizard's lead "reply", subs "context") would ignore a role chosen later on the Channels page,
// so the selection decides instead; a message naming a teammate is left to that teammate.
// When the gate answered, its choice stands, except that the configured fallback lead takes
// a message the gate gave to a selected role that is offline, so it is not left unanswered.
func (e *Engine) leadRouteGate(p Platform, msg *Message, dec gateResponse) string {
	if msg.FromBot || msg.Mentioned || msg.Direct {
		return dec.Action
	}
	if dec.fellBack {
		if msg.AddressedOther {
			if inTeam, _ := e.teamRole(p); inTeam {
				return "context"
			}
			return dec.Action
		}
		r := e.routeUnaddressed(p, msg)
		if !r.decided {
			return dec.Action
		}
		if e.applyLeadRoute(p, msg, r) {
			return "reply"
		}
		return "context"
	}
	if msg.AddressedOther || (dec.Action != "context" && dec.Action != "silent") {
		return dec.Action
	}
	r := e.routeUnaddressed(p, msg)
	if r.decided && r.standIn && r.answer {
		e.applyLeadRoute(p, msg, r)
		return "reply"
	}
	return dec.Action
}
