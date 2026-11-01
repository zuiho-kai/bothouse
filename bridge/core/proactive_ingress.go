package core

import (
	"log/slog"
	"strings"
)

// MessageSourceAuthenticator attests the account namespace supplied by a
// multiplexing adapter. It is called only on its live Platform.Start intake.
type MessageSourceAuthenticator interface {
	AuthenticatedMessageSource(*Message) (string, bool)
}

// Only the registered platform adapter supplies the authenticated intake.
// Local API and replay inputs continue through their existing checked paths.
func (e *Engine) handlePlatformMessage(p Platform, msg *Message) {
	d, managed, err := e.evaluatePlatformFollowup(p, msg)
	if err != nil {
		slog.Warn("platform followup evaluation failed", "error", err)
		return
	}
	if managed {
		if d.Outcome != "eligible" {
			return
		}
		if _, err := e.admitPlatformTask(p, msg, d); err != nil {
			slog.Warn("platform followup admission denied", "error", err)
			return
		}
		e.handleAdmittedMessage(p, msg)
		return
	}
	e.handleMessage(p, msg)
}

// evaluatePlatformFollowup is for the authenticated Platform.Start callback,
// after the adapter's account/channel allowlists. Never call it for webhooks,
// wiki text, backfill, timers or local API messages: those are not platform
// attestations. Every adapter uses this same platform-qualified identity rule.
// The bool identifies an inferred event managed by an installed policy.
func (e *Engine) evaluatePlatformFollowup(p Platform, msg *Message) (AuthorizationDecision, bool, error) {
	command := strings.TrimSpace(e.resolveAlias(msg.Content))
	if msg.Mentioned || msg.Direct || msg.IsPermissionResponse || msg.Recalled || msg.StopAll || strings.HasPrefix(command, "/") || strings.HasPrefix(command, "!") || (!msg.FromBot && (IsStopAllCommand(msg.Content) || e.isUnaddressedStop(msg))) {
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
	source, authenticated := p.Name(), msg.Platform == p.Name()
	if adapter, ok := p.(MessageSourceAuthenticator); ok {
		source, authenticated = adapter.AuthenticatedMessageSource(msg)
	}
	identity := AuthorityIdentity{Platform: source, UserID: msg.UserID}
	principal := ""
	for _, binding := range policy.Bindings {
		for _, id := range binding.Identities {
			if id == identity {
				principal = binding.Principal
			}
		}
	}
	if principal == "" {
		// Installing a policy must not swallow unrelated existing chat flows.
		return AuthorizationDecision{}, false, nil
	}
	// Rules, never user message text or routing output, supply action scopes.
	var scopes []string
	for _, rule := range policy.Rules {
		if rule.Source == source && rule.Principal == principal && rule.SessionKey == msg.SessionKey && rule.EventKind == "message" {
			scopes = rule.Scopes
			break
		}
	}
	if len(scopes) == 0 {
		return AuthorizationDecision{}, false, nil
	}
	actor := "human"
	if msg.FromBot {
		actor = "bot"
	}
	candidate := ProactiveCandidate{
		EventID: msg.MessageID, Source: source, EventKind: "message",
		Identity: identity, SessionKey: msg.SessionKey, Scopes: scopes,
		ActorKind: actor, Intent: "inferred",
		Authenticated: authenticated && msg.UserID != "",
		Visible:       true, ContextOnly: msg.FromBot || msg.AddressedOther,
	}
	d, err := a.Evaluate(candidate)
	return d, true, err
}
