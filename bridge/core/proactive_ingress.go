package core

import "strings"

// evaluatePlatformFollowup is for the authenticated Platform.Start callback,
// after the adapter's account/channel allowlists. Never call it for webhooks,
// wiki text, backfill, timers or local API messages: those are not platform
// attestations. Every adapter uses this same platform-qualified identity rule.
// The bool identifies an inferred event managed by an installed policy.
func (e *Engine) evaluatePlatformFollowup(p Platform, msg *Message) (AuthorizationDecision, bool, error) {
	if msg.Mentioned || msg.Direct || msg.IsPermissionResponse || msg.Recalled || msg.StopAll || strings.HasPrefix(strings.TrimSpace(msg.Content), "/") || (!msg.FromBot && (IsStopAllCommand(msg.Content) || e.isUnaddressedStop(msg))) {
		// Explicit requests and stop/permission paths retain existing checks.
		return AuthorizationDecision{}, false, nil
	}
	if e.dataDir == "" {
		return AuthorizationDecision{}, false, nil
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return AuthorizationDecision{}, true, err
	}
	policy := a.Policy()
	if policy.Version == 0 {
		// Merely installing the software does not change existing chat routing.
		return AuthorizationDecision{}, false, nil
	}
	identity := AuthorityIdentity{Platform: p.Name(), UserID: msg.UserID}
	principal := ""
	for _, binding := range policy.Bindings {
		for _, id := range binding.Identities {
			if id == identity {
				principal = binding.Principal
			}
		}
	}
	// Rules, never user message text or routing output, supply action scopes.
	var scopes []string
	for _, rule := range policy.Rules {
		if rule.Source == p.Name() && rule.Principal == principal && rule.SessionKey == msg.SessionKey && rule.EventKind == "message" {
			scopes = rule.Scopes
			break
		}
	}
	actor := "human"
	if msg.FromBot {
		actor = "bot"
	}
	candidate := ProactiveCandidate{
		EventID: msg.MessageID, Source: p.Name(), EventKind: "message",
		Identity: identity, SessionKey: msg.SessionKey, Scopes: scopes,
		ActorKind: actor, Intent: "inferred",
		Authenticated: msg.Platform == p.Name() && msg.UserID != "",
		Visible:       true, ContextOnly: msg.FromBot || msg.AddressedOther,
	}
	d, err := a.Evaluate(candidate)
	return d, true, err
}
