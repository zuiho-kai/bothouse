package feishu

import (
	"github.com/chenhg5/cc-connect/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

// Platform events (#1061; core/member_events.go). Feishu has no servers: a group chat is the
// channel. Reactions come without the chat, so they carry the message id only. Member and
// disband events arrive only when the app subscribes to them in the Feishu console
// (im.chat.member.user.added_v1 / deleted_v1, im.chat.disbanded_v1).

// SetPlatformEventHandler implements core.PlatformEventSource.
func (p *Platform) SetPlatformEventHandler(h core.PlatformEventHandler) {
	p.mu.Lock()
	p.platformEvents = h
	p.mu.Unlock()
}

// fanOutEvent hands events to every platform on this connection (each its own project);
// allow_chat applies when the event has a chat.
func (p *Platform) fanOutEvent(evs ...core.PlatformEvent) {
	targets := []*Platform{p}
	if p.sharedGroup != nil {
		targets = p.sharedGroup.allPlatforms()
	}
	for _, ev := range evs {
		if ev.Name == "" {
			continue
		}
		for _, t := range targets {
			t.emitEvent(ev)
		}
	}
}

func (p *Platform) emitEvent(ev core.PlatformEvent) {
	if ev.ChannelID != "" && !core.AllowList(p.allowChat, ev.ChannelID) {
		return
	}
	if ev.UserID != "" && ev.UserID == p.botOpenID {
		return
	}
	p.mu.RLock()
	h := p.platformEvents
	p.mu.RUnlock()
	if h != nil {
		h.OnPlatformEvent(p, ev)
	}
}

func str(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func reactionEvent(name core.HookEventType, msgID, opType *string, uid *larkim.UserId, emoji *larkim.Emoji) core.PlatformEvent {
	if str(opType) == "app" {
		return core.PlatformEvent{} // our own (or another app's) reaction
	}
	ev := core.PlatformEvent{Name: name, MessageID: str(msgID), UserID: userIDFromEvent(uid)}
	if emoji != nil {
		ev.Emoji = str(emoji.EmojiType)
	}
	return ev
}

func reactionCreatedEvent(e *larkim.P2MessageReactionCreatedV1) core.PlatformEvent {
	if e == nil || e.Event == nil {
		return core.PlatformEvent{}
	}
	d := e.Event
	return reactionEvent(core.HookEventReactionAdded, d.MessageId, d.OperatorType, d.UserId, d.ReactionType)
}

func reactionDeletedEvent(e *larkim.P2MessageReactionDeletedV1) core.PlatformEvent {
	if e == nil || e.Event == nil {
		return core.PlatformEvent{}
	}
	d := e.Event
	return reactionEvent(core.HookEventReactionRemoved, d.MessageId, d.OperatorType, d.UserId, d.ReactionType)
}

func memberEvents(name core.HookEventType, chatID, chatName *string, users []*larkim.ChatMemberUser) []core.PlatformEvent {
	var out []core.PlatformEvent
	for _, u := range users {
		if u == nil {
			continue
		}
		out = append(out, core.PlatformEvent{Name: name, ChannelID: str(chatID), ChannelName: str(chatName),
			UserID: userIDFromEvent(u.UserId), UserName: str(u.Name)})
	}
	return out
}

func memberAddedEvents(e *larkim.P2ChatMemberUserAddedV1) []core.PlatformEvent {
	if e == nil || e.Event == nil {
		return nil
	}
	return memberEvents(core.HookEventMemberJoined, e.Event.ChatId, e.Event.Name, e.Event.Users)
}

func memberDeletedEvents(e *larkim.P2ChatMemberUserDeletedV1) []core.PlatformEvent {
	if e == nil || e.Event == nil {
		return nil
	}
	return memberEvents(core.HookEventMemberLeft, e.Event.ChatId, e.Event.Name, e.Event.Users)
}

func chatDisbandedEvent(e *larkim.P2ChatDisbandedV1) core.PlatformEvent {
	if e == nil || e.Event == nil {
		return core.PlatformEvent{}
	}
	return core.PlatformEvent{Name: core.HookEventChannelDeleted, ChannelID: str(e.Event.ChatId), ChannelName: str(e.Event.Name),
		UserID: userIDFromEvent(e.Event.OperatorId)}
}
