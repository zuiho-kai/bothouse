package core

import (
	"context"
	"testing"
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
