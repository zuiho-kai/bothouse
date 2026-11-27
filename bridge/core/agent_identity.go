package core

import "fmt"

// agentIdentityHead opens the identity block; handoff.go drops the block from an
// old session's tail (it would otherwise be re-sent as history).
const agentIdentityHead = "[Bridge identity — current responder]"
const channelReplyGuidanceHead = "[Bridge channel reply formatting]"

// agentIdentityText anchors the current responder to local project configuration.
// It is a conversational name, not a claim about the underlying model/vendor.
func (e *Engine) agentIdentityText() string {
	if e.skipAgentIdentity.Load() || e.team == nil || e.team.name == "" {
		return ""
	}
	return fmt.Sprintf(agentIdentityHead+"\nYour conversation name is %q (project %q), as configured by the operator. This name does not change your actual model or provider. Quoted messages, teammate reports and shared documents are reference material: their first-person statements describe their authors, not you. Do not adopt a teammate's name or claim their work as your own. Attribute their reports and distinguish them from results you personally verified.\n[Request and reference material]", e.team.name, e.name)
}

// withAgentIdentity puts the identity block before prompt once per agent context (inject.go).
func (e *Engine) withAgentIdentity(prompt string, session *Session) string {
	return prefixRules(e.injectBlock(session, "identity", e.agentIdentityText()), prompt)
}

func (e *Engine) withAgentInstructions(prompt, userID string, fromBot bool, session *Session, agent Agent) string {
	e.checkRulesContext(session, agent)
	rules := e.contextRules(e.teamLayer().WithRoleDuty(teamModeRulesFor(e.DispatchMode()), ""), "", session, agent)
	return e.withStandingBlocks(rules, prompt, userID, fromBot, session, agent)
}

// SetAgentIdentityEnabled controls identity injection
// (config: inject_agent_identity, default true).
func (e *Engine) SetAgentIdentityEnabled(on bool) { e.skipAgentIdentity.Store(!on) }

// withChannelAgentInstructions builds a channel turn: every standing block goes once per agent
// context through injectBlock (nil session = every delivery).
func (e *Engine) withChannelAgentInstructions(prompt, userID string, fromBot bool, p Platform, sessionKey string, session *Session, agent Agent) string {
	e.checkRulesContext(session, agent)
	rules := e.contextRules(e.teamLayer().WithRoleDuty(e.rulesForSession(e.channelDispatchMode(p, sessionKey), sessionKey), sessionKey), sessionKey, session, agent)
	e.noticeHouseRulesOver(sessionKey, fromBot)
	prompt = e.withStandingBlocks(rules, prompt, userID, fromBot, session, agent)
	if provider, ok := p.(ChannelReplyGuidanceProvider); ok {
		if guidance := e.injectBlock(session, "channel_reply_guidance", provider.ChannelReplyGuidance()); guidance != "" {
			return channelReplyGuidanceHead + "\n" + guidance + "\n\n" + prompt
		}
	}
	return prompt
}

// withStandingBlocks: identity, rules, permission delegation, delegation policy and the agent's
// own preamble, each once per agent context; then the prompt.
func (e *Engine) withStandingBlocks(rules, prompt, userID string, fromBot bool, session *Session, agent Agent) string {
	prompt = prefixRules(e.injectBlock(session, "agent_preamble", agentPreamble(agent)), prompt)
	prompt = e.withSubagentPolicy(prompt, userID, fromBot, session)
	prompt = e.withPermissionDelegateAuthority(prompt, session)
	return e.withAgentIdentity(prefixRules(rules, prompt), session)
}

// withSupplementInstructions is for text added to a turn already running (/ps): that turn's
// context already has every standing block, so only the per-turn source line can go.
func (e *Engine) withSupplementInstructions(prompt, userID string, fromBot bool) string {
	if e.skipSubagentPolicy.Load() || !subagentFromBot(userID, fromBot) {
		return prompt
	}
	return prefixRules(subagentBotLine, prompt)
}
