package core

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

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

func TestManagementProactiveRenewalRevalidatesPersistedGrant(t *testing.T) {
	_, server, e := testManagementServer(t, "test-secret")
	platform := newProgressPlatform()
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	p := e.publicProgress
	p.workspaceChat = func(string) bool { return true }
	run := p.begin(platform, "discord:room", LangEnglish, nil)
	taskID, err := p.Report(PublicProgressRequest{Project: e.name, SessionKey: "discord:room", Run: run, Seq: 1, Kind: "start", Title: "follow-up", Summary: "begin"})
	if err != nil {
		t.Fatal(err)
	}
	a, old := authorizeFixtureTask(t, e, taskID, []string{"task.resume"})
	policy := a.Policy()
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	request := func(token string) (int, []byte) {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/projects/test-project/authorization/renew/"+taskID, nil)
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		return resp.StatusCode, body
	}
	if code, _ := request(""); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated renewal: %d", code)
	}
	before, _ := p.Task(taskID)
	if before.AuthorizationDecisionID != old.ID {
		t.Fatal("unauthenticated request changed task")
	}
	code, body := request("test-secret")
	if code != http.StatusOK {
		t.Fatalf("renewal: %d %s", code, body)
	}
	var response struct{ Data map[string]string }
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatal(err)
	}
	next := response.Data["decision_id"]
	task, _ := p.Task(taskID)
	if next == "" || next == old.ID || task.AuthorizationDecisionID != next || a.Check(next, "task.resume") != nil {
		t.Fatal("endpoint did not renew task grant")
	}
	if err := a.Revoke(next, "owner"); err != nil {
		t.Fatal(err)
	}
	policy = a.Policy()
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	if code, _ := request("test-secret"); code != http.StatusConflict {
		t.Fatalf("withdrawn task renewed: %d", code)
	}
}
