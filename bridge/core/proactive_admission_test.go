package core

import (
	"testing"
)

func TestProactivePlatformAdmissionDurableAndEventScoped(t *testing.T) {
	p := newProgressPlatform()
	e := NewEngine("role", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	a, c := authorizationFixture(t, ProactiveAuto)
	e.proactiveAuthorization = a
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	msg := &Message{SessionKey: c.SessionKey}
	task, err := e.admitPlatformTask(p, msg, d)
	if err != nil {
		t.Fatal(err)
	}
	if task.AuthorizationDecisionID != d.ID || e.CheckTaskAuthorization(task, "task.resume") != nil {
		t.Fatal("task did not retain grant")
	}
	if _, err := e.admitPlatformTask(p, msg, d); err != ErrAuthorizationDuplicate {
		t.Fatalf("repeated candidate: %v", err)
	}
	reopened, err := NewPublicProgress(e.dataDir, e.name, []Platform{p})
	if err != nil {
		t.Fatal(err)
	}
	e.publicProgress = reopened
	if _, err := e.admitPlatformTask(p, msg, d); err != ErrAuthorizationDuplicate {
		t.Fatal("restart readmitted event")
	}
	policy := a.Policy()
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	if _, err := e.admitPlatformTask(p, msg, d); err == nil {
		t.Fatal("old decision admitted")
	}
}
