package cloudweb

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

// The DSH collab gateway sends every room message to every bot in the room with the room's members
// (wireInboundMessage.Members) and the raw text; who the message calls, and the text each bot reads,
// are decided here (#1662: the plugin is an adapter, the rule lives once, in the bridge). Gateways
// that mark Mentioned themselves (rh/cloudweb.py) send no members and keep the old path.

// bareMention: what a bot reads when it was only @-ed, with nothing else written.
const bareMention = "（只 @ 了你，没写内容：看上面的频道消息判断要你做什么；看不出来就问）"

// readHubMessage rewrites m for this bot: Content as this bot reads it, Mentioned set. ok=false: the
// message is not this bot's to see (it is not in the room, a reply addressed to other bots, or a
// teammate's text with nothing left once this bot's own @ is taken out). elsewhere: a person's
// message @-ing other members and not this bot.
func (p *Platform) readHubMessage(m *wireInboundMessage) (elsewhere, ok bool) {
	var self hubMember
	var team []string
	for _, mem := range m.Members {
		if mem.ID == p.selfID {
			self = mem
		} else if mem.Name != "" {
			team = append(team, mem.Name)
		}
	}
	if self.ID == "" {
		return false, false
	}
	p.rememberRoster(m.Members)
	raw := m.Content
	called := mentionedIDs(raw, m.Members)
	// A person's reply (bridge/platform/discord/reply_routing.go): with an explicit @, the @-ed members
	// plus the replied-to bot; without one, only the replied-to bot; a deleted original names nobody;
	// a reply to a person keeps the normal rules.
	routed := false
	if !m.FromBot && m.ReplyToID != "" {
		only := map[string]bool{}
		switch {
		case len(called) > 0:
			for id := range called {
				only[id] = true
			}
			if m.ReplyToRoleID != "" {
				only[m.ReplyToRoleID] = true
			}
			routed = true
		case m.ReplyToGone:
			routed = true
		case m.ReplyToRoleID != "":
			only[m.ReplyToRoleID] = true
			routed = true
		}
		if routed && !only[self.ID] {
			return false, false
		}
	}
	direct := !m.FromBot && strings.EqualFold(strings.TrimSpace(m.ChatType), "direct")
	hit := routed || called[self.ID] || core.NameCalled(raw, self.Name, team...) || direct
	content := mentionsForMember(raw, self, m.Members)
	switch {
	case m.FromBot:
		if content == "" {
			return false, false
		}
		content = "【" + m.UserName + "】" + m.Quote + content
	case hit && content == "":
		content = m.Quote + bareMention
	default:
		content = m.Quote + content
	}
	if m.Note != "" {
		content += "\n" + m.Note
	}
	m.Content = content
	m.Mentioned = &hit
	return !m.FromBot && !hit && len(called) > 0, true
}

// rememberRoster keeps every member seen (by id), so this bot's own text can be shown with names.
func (p *Platform) rememberRoster(members []hubMember) {
	p.rosterMu.Lock()
	defer p.rosterMu.Unlock()
	if p.roster == nil {
		p.roster = map[string]hubMember{}
	}
	for _, m := range members {
		if m.ID != "" {
			p.roster[m.ID] = m
		}
	}
}

// handleRoster: {"type":"roster","members":[…]}, the hub's members, sent after register.
func (p *Platform) handleRoster(raw []byte) {
	var f struct {
		Members []hubMember `json:"members"`
	}
	if json.Unmarshal(raw, &f) == nil {
		p.rememberRoster(f.Members)
	}
}

func (p *Platform) rosterList() []hubMember {
	p.rosterMu.Lock()
	defer p.rosterMu.Unlock()
	out := make([]hubMember, 0, len(p.roster))
	for _, m := range p.roster {
		out = append(out, m)
	}
	return out
}

// displayMentions: the text this bot posts is stored and shown with every mention as @name
// (<@id>, @id → @名字), the form the channel page and the other bots read.
func (p *Platform) displayMentions(frame map[string]any) {
	switch frame["type"] {
	case "reply", "buttons", "update_message", "preview_start":
	default:
		return
	}
	content, _ := frame["content"].(string)
	if content == "" || strings.HasPrefix(content, core.ProgressCardPayloadPrefix) {
		return
	}
	if members := p.rosterList(); len(members) > 0 {
		frame["content"] = mentionsForDisplay(content, members)
	}
}

// PermissionAnsweredByText: the owner answered this bot's permission prompt in text, so the gateway
// closes the card it shows for it (core.PermissionTextAnswerNotifier).
func (p *Platform) PermissionAnsweredByText(ctx context.Context, sessionKey, decision string) {
	_ = p.sendWire(ctx, map[string]any{"type": "permission_resolved", "session_key": sessionKey, "decision": decision})
}
