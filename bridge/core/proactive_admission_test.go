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

func TestProactiveAdmissionRecoversInterruptedJournalTransfer(t *testing.T) {
	p := newProgressPlatform()
	dir := t.TempDir()
	e := NewEngine("role", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDataDir(dir)
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	a, c := authorizationFixture(t, ProactiveAuto)
	e.proactiveAuthorization = a
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	// A directory at the write target forces the second durable write to fail.
	e.turnJournalStore().path = t.TempDir()
	msg := &Message{SessionKey: c.SessionKey, Content: "private waiting condition"}
	if _, err := e.admitPlatformTask(p, msg, d); err == nil {
		t.Fatal("journal transfer should fail")
	}
	e.publicProgress.mu.Lock()
	if len(e.publicProgress.records) != 1 {
		t.Fatal("admitted task was not kept")
	}
	e.publicProgress.mu.Unlock()
	restarted := NewEngine("role", &stubAgent{}, []Platform{p}, "", LangEnglish)
	restarted.SetDataDir(dir)
	restarted.proactiveAuthorization, err = OpenProactiveAuthorization(a.path)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	restarted.restoreProactiveAdmissions()
	entries := restarted.turnJournalStore().Inherited()
	if len(entries) != 1 || entries[0].Authorization == nil || entries[0].Authorization.DecisionID != d.ID || entries[0].LastUserMessage != msg.Content {
		t.Fatalf("admission not restored into startup scan: %+v", entries)
	}
	if _, err := restarted.admitPlatformTask(p, msg, d); err != ErrAuthorizationDuplicate {
		t.Fatalf("restart replay admitted another task: %v", err)
	}
	restarted.restoreProactiveAdmissions()
	if len(restarted.turnJournalStore().Inherited()) != 1 {
		t.Fatal("restore duplicated intent")
	}
	task, ok := restarted.publicProgress.Task(entries[0].Authorization.TaskID)
	if !ok || restarted.CheckTaskAuthorization(task, "task.resume") != nil {
		t.Fatal("restored task lost original grant")
	}
}
