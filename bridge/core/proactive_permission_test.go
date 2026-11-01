package core

import (
	"context"
	"testing"
	"time"
)

func TestProactivePermissionRechecksAfterCallerLeaves(t *testing.T) {
	p, _, _, id := taskRelayFixture(t)
	a, candidate := authorizationFixture(t, ProactiveAuto)
	policy := a.Policy()
	policy.Rules[0].SessionKey = "discord:room:user"
	policy.Rules[0].Scopes = []string{"tool.execute"}
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	candidate.SessionKey, candidate.Scopes = policy.Rules[0].SessionKey, policy.Rules[0].Scopes
	e := NewEngine("source", &stubAgent{}, nil, "", LangEnglish)
	e.publicProgress, e.proactiveAuthorization = p, a
	d, err := a.Evaluate(candidate)
	if err != nil {
		t.Fatal(err)
	}
	task, _ := p.Task(id)
	if err := e.AdmitProactiveTask(d.ID, task, "backend"); err != nil {
		t.Fatal(err)
	}
	wait, cancel := context.WithCancel(context.Background())
	execution := withProactiveExecution(wait, e, task)
	// The existing relay deliberately outlives a caller timeout. Its grant does
	// not disappear when the waiting context is detached from the executor.
	drain := context.WithoutCancel(execution)
	cancel()
	session := &recordingAgentSession{}
	allow := PermissionResult{Behavior: "allow"}
	if err := respondTaskPermission(drain, session, "before", allow); err != nil {
		t.Fatal(err)
	}
	if session.lastResult.Behavior != "allow" {
		t.Fatal("valid grant rejected")
	}
	if err := a.Revoke(d.ID, "administrator"); err != nil {
		t.Fatal(err)
	}
	if err := respondTaskPermission(drain, session, "after", allow); err == nil {
		t.Fatal("revoked permission accepted")
	}
	if session.lastResult.Behavior != "deny" || session.lastID != "after" {
		t.Fatal("backend did not receive denial")
	}
	if err := respondTaskPermission(drain, session, "denied", PermissionResult{Behavior: "deny"}); err != nil {
		t.Fatal(err)
	}
	if session.lastResult.Behavior != "deny" {
		t.Fatal("normal denial was changed")
	}
}

func TestProactivePermissionPreservesExplicitApproval(t *testing.T) {
	session := &recordingAgentSession{}
	if err := respondTaskPermission(context.Background(), session, "explicit", PermissionResult{Behavior: "allow"}); err != nil {
		t.Fatal(err)
	}
	if session.lastResult.Behavior != "allow" {
		t.Fatal("explicit approval changed")
	}
}

type proactivePermissionSession struct {
	*controllableAgentSession
	permissions chan PermissionResult
}

func (s *proactivePermissionSession) RespondPermission(_ string, result PermissionResult) error {
	s.permissions <- result
	return nil
}

func TestProactiveRelayDrainDeniesStalePermission(t *testing.T) {
	p, _, _, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, nil, "", LangEnglish)
	e.publicProgress = p
	a, d := authorizeFixtureTask(t, e, id, []string{"tool.execute"})
	task, _ := p.Task(id)
	ctx := withProactiveExecution(context.Background(), e, task)
	if err := a.Revoke(d.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	s := &proactivePermissionSession{controllableAgentSession: newControllableSession("drain"), permissions: make(chan PermissionResult, 1)}
	s.events <- Event{Type: EventPermissionRequest, RequestID: "after-stop"}
	ended := make(chan teamWorkOutcome, 1)
	go e.drainRelaySession(ctx, nil, s, &Session{}, NewSessionManager(""), "stub", "relay:key", func(o teamWorkOutcome) { ended <- o }, s.Events(), nil, false, "", nil, nil, nil, nil)
	select {
	case outcome := <-ended:
		if outcome != teamWorkFailed {
			t.Fatalf("outcome: %v", outcome)
		}
	case <-time.After(time.Second):
		t.Fatal("drain did not stop on denied grant")
	}
	select {
	case result := <-s.permissions:
		if result.Behavior != "deny" {
			t.Fatal("drain allowed withdrawn tool")
		}
	default:
		t.Fatal("backend never received denial")
	}
}
