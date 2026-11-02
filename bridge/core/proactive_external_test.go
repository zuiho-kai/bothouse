package core

import (
	"context"
	"testing"
)

func authorizeFixtureTask(t *testing.T, e *Engine, taskID string, scopes []string) (*ProactiveAuthorization, AuthorizationDecision) {
	t.Helper()
	a, c := authorizationFixture(t, ProactiveAuto)
	task, ok := e.publicProgress.Task(taskID)
	if !ok {
		t.Fatal("missing fixture task")
	}
	policy := a.Policy()
	policy.Rules[0].SessionKey, policy.Rules[0].Scopes = task.SessionKey, scopes
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	c.SessionKey, c.Scopes = task.SessionKey, scopes
	e.proactiveAuthorization = a
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AdmitProactiveTask(d.ID, task, "backend"); err != nil {
		t.Fatal(err)
	}
	return a, d
}

func TestProactiveExternalInputCannotMintAuthorityAndRechecksDelivery(t *testing.T) {
	_, e, agent, _, event := externalEngineFixture(t)
	a, d := authorizeFixtureTask(t, e, event.TaskID, []string{"task.resume"})
	event.ActorKind, event.ActorID = "human", "123"
	if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{event}); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	for _, decision := range a.state.Decisions {
		if decision.EventKind == "external_context" && decision.Outcome != "denied" {
			t.Fatal("external actor claim became human authority")
		}
	}
	a.mu.Unlock()
	if err := a.Revoke(d.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	e.flushExternalTaskEvents()
	if agent.normalStarts.Load() != 0 {
		t.Fatal("revoked task started from contextual input")
	}
	event.EventID += "-next"
	if _, err := e.AcceptExternalTaskEvents([]ExternalTaskEvent{event}); err == nil {
		t.Fatal("revoked task accepted new input")
	}
}

func TestProactiveTaskTextChecksBetweenParts(t *testing.T) {
	platform := &textTestPlatform{progressTestPlatform: newProgressPlatform()}
	e := NewEngine("owner", &stubAgent{}, []Platform{platform}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	p := e.publicProgress
	p.workspaceChat = func(string) bool { return true }
	run := p.begin(platform, "discord:room", LangEnglish, nil)
	id, err := p.Report(PublicProgressRequest{Project: e.name, SessionKey: "discord:room", Run: run, Seq: 1, Kind: "start", Title: "work", Summary: "begin"})
	if err != nil {
		t.Fatal(err)
	}
	a, d := authorizeFixtureTask(t, e, id, []string{"message.send"})
	queueText(t, p, TaskTextRequest{TaskID: id, Revision: 1, DeliveryID: "out", SessionKey: "discord:room", Kind: "result", Text: "one|two"})
	platform.send = func(_, _ string) (string, error) { return "receipt", a.Revoke(d.ID, "owner") }
	p.FlushTaskText(context.Background())
	p.FlushTaskText(context.Background())
	if len(platform.calls) != 1 || platform.calls[0] != "one" {
		t.Fatalf("sent after revocation: %v", platform.calls)
	}
}
