package core

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestProactiveEngineObserveDoesNotExecuteOrSend(t *testing.T) {
	a, c := authorizationFixture(t, ProactiveObserve)
	e := NewEngine("role", &stubAgent{}, nil, "", LangEnglish)
	e.proactiveAuthorization = a
	d, err := e.EvaluateProactiveCandidate(c)
	if err != nil {
		t.Fatal(err)
	}
	task := &Task{ID: "task", Agent: "role", SessionKey: "room", State: TaskStateInProgress}
	if e.AdmitProactiveTask(d.ID, task, "backend") == nil {
		t.Fatal("observe admitted executor")
	}
	task.AuthorizationDecisionID = d.ID
	calls := 0
	if e.RunAuthorizedEffect(context.Background(), task, "message.send", "send", func(context.Context) error { calls++; return nil }) == nil || calls != 0 {
		t.Fatal("observe called side effect")
	}
}
func TestProactiveEngineWaitingAndNonCodeFollowup(t *testing.T) {
	a, c := authorizationFixture(t, ProactiveAuto)
	e := NewEngine("role", &stubAgent{}, nil, "", LangEnglish)
	e.proactiveAuthorization = a
	d, err := e.EvaluateProactiveCandidate(c)
	if err != nil {
		t.Fatal(err)
	}
	task := &Task{ID: "waiting-review", Agent: "role", SessionKey: "room", State: TaskStateWaitingUser}
	if err = e.AdmitProactiveTask(d.ID, task, "configured-backend"); err != nil {
		t.Fatal(err)
	}
	calls := 0
	send := func(context.Context) error { calls++; return nil }
	if err = e.RunAuthorizedEffect(context.Background(), task, "message.send", "review-ready", send); err != nil {
		t.Fatal(err)
	}
	if e.RunAuthorizedEffect(context.Background(), task, "message.send", "review-ready", send) == nil || calls != 1 {
		t.Fatal("duplicate followup")
	}
	if err = a.Revoke(d.ID, "owner:stop"); err != nil {
		t.Fatal(err)
	}
	if e.RunAuthorizedEffect(context.Background(), task, "message.send", "later", send) == nil || calls != 1 {
		t.Fatal("stop ignored")
	}
	forged := *task
	forged.ID = "unrelated"
	if e.CheckTaskAuthorization(&forged, "message.send") == nil {
		t.Fatal("decision reused by another task")
	}
}
func TestManagementProactiveAuthorization(t *testing.T) {
	_, server, e := testManagementServer(t, "test-secret")
	e.SetDataDir(t.TempDir())
	request := func(method, path, body, token string) (int, string) {
		t.Helper()
		req, _ := http.NewRequest(method, server.URL+"/api/v1/projects/test-project/authorization"+path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if code, _ := request("GET", "", "", ""); code != 401 {
		t.Fatal("unauthenticated audit exposed")
	}
	a, c := authorizationFixture(t, ProactiveObserve)
	p := a.Policy()
	p.Version = 0
	p.Authority = "forged-human-name"
	body, _ := json.Marshal(p)
	code, b := request("PUT", "/policy", string(body), "test-secret")
	if code != 200 || strings.Contains(b, "forged-human-name") {
		t.Fatalf("%d %s", code, b)
	}
	code, _ = request("PUT", "/policy", string(body), "test-secret")
	if code != 409 {
		t.Fatal("lost update not rejected")
	}
	d, err := e.EvaluateProactiveCandidate(c)
	if err != nil || d.Outcome != "would_accept" {
		t.Fatalf("%+v %v", d, err)
	}
	code, b = request("GET", "", "", "test-secret")
	if code != 200 || !strings.Contains(b, d.ID) {
		t.Fatalf("missing administrator audit %d %s", code, b)
	}
	code, _ = request("POST", "/revoke/"+d.ID, "", "test-secret")
	if code != 200 {
		t.Fatal("withdrawal failed")
	}
}
