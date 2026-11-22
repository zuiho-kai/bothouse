package feishu

import (
	"strings"
	"time"

	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: team work between bots on Feishu, the same rules as platform/discord
// (discord.go allow_bots filter, lead_return.go). Another bot's message gets in only when its
// sender id is listed in allow_bots and it @-s this bot. team_lead_bot names the primary role:
// when the lead @-s this sub (or a person @-s this sub and the lead together), the turn's final
// answer gets an @ to the lead prepended, so the lead is woken even if the model forgets the @.
// Both options hold ids as this app sees them in events (sender_id / mentions open_id).

const leadReturnTTL = 24 * time.Hour

// senderIsBot reports whether a receive event comes from a bot. The event reference says
// sender_type is "user" or "bot"; older payloads carry "app". Both count.
func senderIsBot(sender *larkim.EventSender) bool {
	if sender == nil || sender.SenderType == nil {
		return false
	}
	return *sender.SenderType == "app" || *sender.SenderType == "bot"
}

// botAllowed: a message from another bot gets through when its sender id is in allow_bots.
func (p *Platform) botAllowed(id string) bool {
	return p.allowBots != "" && core.AllowList(p.allowBots, id)
}

// dispatchedBy is the primary role whose turn this is to hand back ("" = none): the lead @-ing
// this sub, or a person's message that @-s this sub and the lead together.
func (p *Platform) dispatchedBy(fromBot, mentioned bool, senderID string, mentions []*larkim.MentionEvent) string {
	if !mentioned || p.teamLead == "" || p.teamLead == p.getBotOpenID() {
		return ""
	}
	if fromBot {
		if senderID == p.teamLead {
			return p.teamLead
		}
		return ""
	}
	if isBotMentioned(mentions, p.teamLead) {
		return p.teamLead
	}
	return ""
}

// returnToLead prepends an @ to the lead to the final answer of a lead-dispatched turn, once per
// trigger message. The at tag makes buildReplyContent send plain text, the only message type
// whose <at> notifies the mentioned bot.
func (p *Platform) returnToLead(rc replyContext, content string) string {
	if !rc.final || rc.lead == "" || rc.messageID == "" || strings.TrimSpace(content) == "" {
		return content
	}
	now := time.Now()
	if _, seen := p.leadReturned.LoadOrStore(rc.messageID, now); seen {
		return content
	}
	p.leadReturned.Range(func(k, v any) bool {
		if t, ok := v.(time.Time); ok && now.Sub(t) > leadReturnTTL {
			p.leadReturned.Delete(k)
		}
		return true
	})
	if strings.Contains(content, `<at user_id="`+rc.lead+`">`) {
		return content
	}
	return `<at user_id="` + rc.lead + `"></at> ` + content
}

// MarkFinalReply implements core.FinalReplyMarker.
func (p *Platform) MarkFinalReply(replyCtx any) any {
	if rc, ok := replyCtx.(replyContext); ok {
		rc.final = true
		return rc
	}
	return replyCtx
}

// MergeInjectedReply implements core.InjectedReplyMerger: a lead's @ injected into a running turn
// marks that turn as lead-dispatched.
func (p *Platform) MergeInjectedReply(turnCtx, injectedCtx any) any {
	t, ok := turnCtx.(replyContext)
	if !ok || t.lead != "" {
		return turnCtx
	}
	if in, ok := injectedCtx.(replyContext); ok && in.lead != "" {
		t.lead = in.lead
	}
	return t
}

// HasConfiguredTeamLead reports whether team_lead_bot is set (core.ConfiguredTeamLead).
func (p *Platform) HasConfiguredTeamLead() bool { return p.teamLead != "" }

// IsConfiguredTeamLead reports whether team_lead_bot names this bot (core.ConfiguredTeamLeadSelf).
func (p *Platform) IsConfiguredTeamLead() bool {
	return p.teamLead != "" && p.teamLead == p.getBotOpenID()
}

var (
	_ core.FinalReplyMarker       = (*Platform)(nil)
	_ core.InjectedReplyMerger    = (*Platform)(nil)
	_ core.ConfiguredTeamLead     = (*Platform)(nil)
	_ core.ConfiguredTeamLeadSelf = (*Platform)(nil)
)
