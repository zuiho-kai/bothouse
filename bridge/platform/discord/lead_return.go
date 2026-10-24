package discord

import (
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: when the team lead @-s a sub to hand it work, the sub's answer must reach the
// lead even if the model forgets to write <@lead> (2026-10-14: 龙娘 finished a task with
// "交橘验收" and no @, so 橘 only saw it as context). The turn's final answer gets <@lead>
// prepended (interim posts don't, so the lead isn't woken mid-task); the normal bot→bot path
// (burst, gate) does the rest. Known gaps (fall back to the persona's own @): a
// turn whose text all went out as interim segments sends no final post, and a degraded stream
// preview finished by in-place edit never creates a message.

const leadReturnTTL = 24 * time.Hour

// dispatchedBy is the team lead whose turn this is to hand back ("" = none): the lead @-ing this sub,
// or a person's message that @-s this sub and the lead together (issue #182, 2026-10-20「龙娘算，橘核对」:
// both bots answered at once and 橘 "checked" an 80-minute-old message). The sub answers, its final
// answer @-s the lead, and the lead (whose gate keeps it quiet on that message) checks the answer then.
// content is the text after this bot's own @ was removed or marked.
func (p *Platform) dispatchedBy(fromBot, mentioned bool, authorID, content string) string {
	if !mentioned || p.teamLead == "" || p.teamLead == p.botID {
		return ""
	}
	if fromBot {
		if authorID == p.teamLead {
			return p.teamLead
		}
		return ""
	}
	if strings.Contains(content, "<@"+p.teamLead+">") || strings.Contains(content, "<@!"+p.teamLead+">") {
		return p.teamLead
	}
	return ""
}

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
	if strings.Contains(content, "<@"+rc.lead+">") || strings.Contains(content, "<@!"+rc.lead+">") {
		return content
	}
	return "<@" + rc.lead + "> " + content
}

// keepLead is the reply context for a burst of the lead's messages merged into one turn: the
// latest message's, but still marked as lead-dispatched if any part of the burst @-ed this sub.
func keepLead(prev, next any) any {
	n, ok := next.(replyContext)
	if !ok || n.lead != "" {
		return next
	}
	if pr, ok := prev.(replyContext); ok && pr.lead != "" {
		n.lead = pr.lead
	}
	return n
}

// MergeInjectedReply implements core.InjectedReplyMerger: a lead's @ injected into a running turn
// marks that turn as lead-dispatched, the same rule keepLead applies to a merged burst.
func (p *Platform) MergeInjectedReply(turnCtx, injectedCtx any) any {
	return keepLead(injectedCtx, turnCtx)
}

var _ core.InjectedReplyMerger = (*Platform)(nil)

// HasConfiguredTeamLead reports whether team_lead_bot is set (core.ConfiguredTeamLead).
func (p *Platform) HasConfiguredTeamLead() bool { return p.teamLead != "" }

// IsConfiguredTeamLead reports whether team_lead_bot names this bot (core.ConfiguredTeamLeadSelf).
func (p *Platform) IsConfiguredTeamLead() bool { return p.teamLead != "" && p.teamLead == p.botID }

// addressedOther reports whether a person's message @-s or names (at a line start) another
// team bot rather than this one, so a no-gate lead leaves it to that teammate.
func addressedOther(content, selfID string) bool {
	other := false
	teamPlatforms.Range(func(k, v any) bool {
		id, _ := k.(string)
		tp, _ := v.(*Platform)
		if id == "" || id == selfID || tp == nil {
			return true
		}
		if strings.Contains(content, "<@"+id+">") || strings.Contains(content, "<@!"+id+">") ||
			(tp.botName != "" && nameCalled(content, tp.botName, teamBotNames(id)...)) {
			other = true
			return false
		}
		return true
	})
	return other
}
