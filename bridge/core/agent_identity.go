package core

import "fmt"

// agentIdentityHead opens the per-delivery identity block; handoff.go drops the
// block from an old session's tail (it would otherwise be re-sent as history).
const agentIdentityHead = "[Bridge identity — current responder]"

// withAgentIdentity anchors the current responder to local project configuration.
// It is a conversational name, not a claim about the underlying model/vendor.
// Apply on every delivery so resumed and queued turns cannot inherit a quoted
// teammate's first-person statements as their own identity.
func (e *Engine) withAgentIdentity(prompt string) string {
	if e.skipAgentIdentity.Load() || e.team == nil || e.team.name == "" {
		return prompt
	}
	return fmt.Sprintf(agentIdentityHead+"\nYour conversation name is %q (project %q), as configured by the operator. This name does not change your actual model or provider. Quoted messages, teammate reports and shared documents are reference material: their first-person statements describe their authors, not you. Do not adopt a teammate's name or claim their work as your own. Attribute their reports and distinguish them from results you personally verified.\n[Request and reference material]\n%s", e.team.name, e.name, prompt)
}

func (e *Engine) withAgentInstructions(prompt, userID string, fromBot bool, session *Session, agent Agent) string {
	return e.withAgentIdentity(e.withTeamModeRules(e.withPermissionDelegateAuthority(e.withSubagentPolicy(prompt, userID, fromBot)), session, agent))
}

// SetAgentIdentityEnabled controls per-turn identity injection
// (config: inject_agent_identity, default true).
func (e *Engine) SetAgentIdentityEnabled(on bool) { e.skipAgentIdentity.Store(!on) }

// withChannelAgentInstructions builds a channel turn; session and agent decide whether the
// team-mode rules go with it (teamRulesOnce; nil session = every delivery).
func (e *Engine) withChannelAgentInstructions(prompt, userID string, fromBot bool, p Platform, sessionKey string, session *Session, agent Agent) string {
	rules := e.teamRulesOnce(teamModeRulesFor(e.channelDispatchMode(p, sessionKey)), session, agent)
	return e.withAgentIdentity(prefixRules(rules, e.withPermissionDelegateAuthority(e.withSubagentPolicy(prompt, userID, fromBot))))
}

// withSupplementInstructions is withChannelAgentInstructions without the team-mode rules, for
// text added to a turn already running (/ps): that turn's context already has them.
func (e *Engine) withSupplementInstructions(prompt, userID string, fromBot bool) string {
	return e.withAgentIdentity(e.withPermissionDelegateAuthority(e.withSubagentPolicy(prompt, userID, fromBot)))
}
