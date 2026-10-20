package cloudweb

import (
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork, ported from platform/discord/lead_return.go (user 2026-10-20「你可以去修一下自建平台…
// 你先看看距离discord差异有什么」): when the team lead @-s a sub to hand it work, the sub's answer must
// reach the lead even if the model forgets to write <@lead>. The turn's final answer gets <@lead>
// prepended (interim posts don't, so the lead isn't woken mid-task); the gateway relays it to the lead
// as a mention and the gate does the rest. The lead is recognised by the sender's user_mention_id
// (the gateway's equivalent of Discord's author ID), compared with team_lead_bot — the same value as
// the Discord platform's. Known gaps, same as Discord (fall back to the persona's own @): a turn whose
// text all went out as interim segments sends no final post, and a degraded stream preview finished
// by in-place edit never creates a message.

const leadReturnTTL = 24 * time.Hour // same as platform/discord/lead_return.go

// dispatchedBy is the team lead whose turn this is to hand back ("" = none), the same rule as
// platform/discord dispatchedBy: the lead @-ing this sub, or a person's message that @-s this sub and
// the lead together (issue #182). The gateway writes the lead's @ as <@team_lead_bot> for every bot
// but the lead (rh/cloudweb.py for_bot).
func (p *Platform) dispatchedBy(m wireInboundMessage) string {
	if m.Mentioned == nil || !*m.Mentioned || p.teamLead == "" {
		return ""
	}
	if m.FromBot {
		if m.UserMentionID == p.teamLead {
			return p.teamLead
		}
		return ""
	}
	if strings.Contains(m.Content, "<@"+p.teamLead+">") || strings.Contains(m.Content, "<@!"+p.teamLead+">") {
		return p.teamLead
	}
	return ""
}

func (p *Platform) returnToLead(rc replyContext, content string) string {
	if !rc.final || rc.lead == "" || rc.MsgID == "" || strings.TrimSpace(content) == "" {
		return content
	}
	now := time.Now()
	if _, seen := p.leadReturned.LoadOrStore(rc.MsgID, now); seen {
		return content
	}
	p.leadReturned.Range(func(k, v any) bool {
		if t, ok := v.(time.Time); ok && now.Sub(t) > leadReturnTTL {
			p.leadReturned.Delete(k)
		}
		return true
	})
	if strings.Contains(content, "<@"+rc.lead+">") || strings.Contains(content, "<@!"+rc.lead+">") {
		return content
	}
	return "<@" + rc.lead + "> " + content
}

// MarkFinalReply implements core.FinalReplyMarker.
func (p *Platform) MarkFinalReply(replyCtx any) any {
	switch rc := replyCtx.(type) {
	case replyContext:
		rc.final = true
		return rc
	case *replyContext:
		if rc != nil {
			c := *rc
			c.final = true
			return c
		}
	}
	return replyCtx
}

// MergeInjectedReply implements core.InjectedReplyMerger (same rule as platform/discord): when the
// lead's @ is injected into a turn already running (user 2026-10-20, room 2: the user's message had
// started the turn, 橘's dispatch arrived mid-turn as "↪ 已插入"), the turn keeps answering its own
// trigger but its final answer returns to the lead.
func (p *Platform) MergeInjectedReply(turnCtx, injectedCtx any) any {
	in, ok := injectedCtx.(replyContext)
	if !ok || in.lead == "" {
		return turnCtx
	}
	switch rc := turnCtx.(type) {
	case replyContext:
		if rc.lead == "" {
			rc.lead = in.lead
		}
		return rc
	case *replyContext:
		if rc != nil {
			c := *rc
			if c.lead == "" {
				c.lead = in.lead
			}
			return c
		}
	}
	return turnCtx
}

var _ core.InjectedReplyMerger = (*Platform)(nil)
