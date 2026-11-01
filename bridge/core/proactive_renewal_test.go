package core

import "testing"

func TestProactivePolicyRenewalPreservesTaskAndDeniesOldGrant(t *testing.T) {
	p, _, _, taskID := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, nil, "", LangEnglish)
	e.publicProgress = p
	a, old := authorizeFixtureTask(t, e, taskID, []string{"task.resume"})
	policy := a.Policy()
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	if a.Check(old.ID, "task.resume") == nil {
		t.Fatal("old evaluation survived policy change")
	}
	next, err := e.RenewTaskAuthorization(taskID)
	if err != nil {
		t.Fatal(err)
	}
	if next == old.ID {
		t.Fatal("mutated old evaluation")
	}
	task, _ := p.Task(taskID)
	if task.AuthorizationDecisionID != next || e.CheckTaskAuthorization(task, "task.resume") != nil {
		t.Fatal("renewed task not usable")
	}
	if a.Check(old.ID, "task.resume") == nil {
		t.Fatal("renewal revived old grant")
	}
	if err := a.Admit(next, "duplicate-task", "source", "backend", task.SessionKey); err == nil {
		t.Fatal("renewal created duplicate task")
	}
	if got, err := a.Renew(old.ID, taskID, "management:administrator"); err != nil || got != next {
		t.Fatalf("retry: %s %v", got, err)
	}
	reopened, err := OpenProactiveAuthorization(a.path)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Check(next, "task.resume") != nil {
		t.Fatal("renewal lost on restart")
	}
	if err := a.Revoke(next, "owner"); err != nil {
		t.Fatal(err)
	}
	policy = a.Policy()
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	if _, err := e.RenewTaskAuthorization(taskID); err == nil {
		t.Fatal("explicit withdrawal revived by renewal")
	}
}

func TestProactiveRenewalCannotExpandScopesOrRestoreRemovedRule(t *testing.T) {
	a, c := authorizationFixture(t, ProactiveAuto)
	old, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Admit(old.ID, "task", "role", "backend", c.SessionKey); err != nil {
		t.Fatal(err)
	}
	p := a.Policy()
	p.Rules = nil
	if err := a.ReplacePolicy(p.Version, p); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Renew(old.ID, "task", "administrator"); err == nil {
		t.Fatal("removed rule restored")
	}
	if _, err := a.Renew(old.ID, "other-task", "administrator"); err == nil {
		t.Fatal("different task adopted old authority")
	}
}
