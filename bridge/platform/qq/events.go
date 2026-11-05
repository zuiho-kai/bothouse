package qq

import (
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

// Platform events (#1061; core/member_events.go) from OneBot notices. A QQ group is the
// channel (no servers). member.joined / member.left: group_increase / group_decrease;
// reaction.added: NapCat's group_msg_emoji_like (one event per emoji). Other notices are ignored.

// SetPlatformEventHandler implements core.PlatformEventSource.
func (p *Platform) SetPlatformEventHandler(h core.PlatformEventHandler) {
	p.mu.Lock()
	p.platformEvents = h
	p.mu.Unlock()
}

func idString(v any) string {
	switch n := v.(type) {
	case float64:
		return fmt.Sprintf("%.0f", n)
	case string:
		return n
	case int64:
		return fmt.Sprintf("%d", n)
	}
	return ""
}

// noticeEvents maps one OneBot notice to platform events; self is the bot's QQ id.
func noticeEvents(payload map[string]any, self string) []core.PlatformEvent {
	user, group := idString(payload["user_id"]), idString(payload["group_id"])
	if user != "" && user == self {
		return nil
	}
	switch t, _ := payload["notice_type"].(string); t {
	case "group_increase":
		return []core.PlatformEvent{{Name: core.HookEventMemberJoined, ChannelID: group, UserID: user}}
	case "group_decrease":
		return []core.PlatformEvent{{Name: core.HookEventMemberLeft, ChannelID: group, UserID: user}}
	case "group_msg_emoji_like":
		msg := idString(payload["message_id"])
		likes, _ := payload["likes"].([]any)
		var out []core.PlatformEvent
		for _, l := range likes {
			m, _ := l.(map[string]any)
			out = append(out, core.PlatformEvent{Name: core.HookEventReactionAdded, ChannelID: group, UserID: user,
				MessageID: msg, Emoji: idString(m["emoji_id"])})
		}
		return out
	}
	return nil
}

func (p *Platform) handleNotice(payload map[string]any) {
	p.mu.Lock()
	h := p.platformEvents
	self := ""
	if p.selfID != 0 {
		self = fmt.Sprintf("%d", p.selfID)
	}
	p.mu.Unlock()
	if h == nil {
		return
	}
	for _, ev := range noticeEvents(payload, self) {
		h.OnPlatformEvent(p, ev)
	}
}
