package core

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
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

func TestProactiveRelayRevocationStopsBackgroundDrain(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	sent := make(chan struct{})
	rm, session := taskRelayManager(t, p, platform, func(string) { close(sent) }, &starts)
	source := rm.engines["source"]
	a, c := authorizationFixture(t, ProactiveAuto)
	policy := a.Policy()
	policy.Rules[0].Scopes = []string{"task.dispatch"}
	policy.Rules[0].SessionKey = "discord:room:user"
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	c.Scopes, c.SessionKey = []string{"task.dispatch"}, "discord:room:user"
	source.proactiveAuthorization = a
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	task, _ := p.Task(id)
	if err := source.AdmitProactiveTask(d.ID, task, "backend"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := relayWatchSend(rm, ctx, id)
	<-sent
	cancel()
	got := relayWatchResult(t, done, "wait should release while executor continues")
	if got.err == nil || !strings.Contains(got.err.Error(), "execution continues") {
		t.Fatalf("unexpected wait result: %v", got.err)
	}
	select {
	case <-session.closed:
		t.Fatal("wait cancellation stopped executor")
	default:
	}
	if err := a.Revoke(d.ID, "owner:stop"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-session.closed:
	case <-time.After(time.Second):
		t.Fatal("revocation left background executor running")
	}
	relayWatchWait(t, "revoked relay outcome checkpoint", func() bool { record, ok := relayWatchRecord(p, id); return ok && record.Status == "failed" })
	if _, err := rm.Send(context.Background(), taskRelayRequest(id)); err == nil || starts.Load() != 1 {
		t.Fatal("revoked relay restarted")
	}
}

func TestProactiveEngineRevocationCancelsInFlightAndRecordsOutcome(t *testing.T) {
	a, c := authorizationFixture(t, ProactiveAuto)
	e := NewEngine("role", &stubAgent{}, nil, "", LangEnglish)
	e.proactiveAuthorization = a
	d, err := e.EvaluateProactiveCandidate(c)
	if err != nil {
		t.Fatal(err)
	}
	task := &Task{ID: "task", Agent: "role", SessionKey: "room", State: TaskStateInProgress}
	if err := e.AdmitProactiveTask(d.ID, task, "backend"); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- e.RunAuthorizedEffect(context.Background(), task, "message.send", "in-flight", func(ctx context.Context) error {
			close(started)
			<-ctx.Done()
			// The remote service already accepted the send. Cancellation cannot undo it.
			return nil
		})
	}()
	<-started
	if err := a.Revoke(d.ID, "owner:stop"); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("revocation did not cancel executor")
	}
	snapshot, err := a.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	var state authorizationState
	if err := json.Unmarshal(snapshot, &state); err != nil {
		t.Fatal(err)
	}
	effect := state.Effects["in-flight"]
	if effect.Result != "succeeded" || effect.FinishedAt == nil {
		t.Fatalf("lost actual result: %+v", effect)
	}
	if err := e.RunAuthorizedEffect(context.Background(), task, "message.send", "after-stop", func(context.Context) error { t.Error("executed after stop"); return nil }); err == nil {
		t.Fatal("stopped task accepted")
	}
}

func TestProactiveNoticeRecoveryAndIdempotency(t *testing.T) {
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "role", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room", LangEnglish, nil)
	id, err := p.Report(PublicProgressRequest{Project: "role", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "Follow up", Summary: "Waiting for review"})
	if err != nil {
		t.Fatal(err)
	}
	a, c := authorizationFixture(t, ProactiveAuto)
	e := NewEngine("role", &stubAgent{}, nil, "", LangEnglish)
	e.proactiveAuthorization, e.publicProgress = a, p
	e.SetDataDir(dir)
	e.platforms = []Platform{platform}
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	task, _ := p.Task(id)
	if err := e.AdmitProactiveTask(d.ID, task, "backend"); err != nil {
		t.Fatal(err)
	}
	policy := a.Policy()
	policy.Mode = ProactiveOff
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	// Simulate restart before the committed policy change was projected.
	e.proactiveAuthorization, err = OpenProactiveAuthorization(a.path)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	task, _ = e.publicProgress.Task(id)
	if task.AuthorizationDecisionID != d.ID || task.AuthorizationNoticeVersion != policy.Version+1 {
		t.Fatalf("missing durable notice: %+v", task)
	}
	seq := task.Seq
	if err := e.SyncAuthorizationNotices(); err != nil {
		t.Fatal(err)
	}
	task, _ = e.publicProgress.Task(id)
	if task.Seq != seq {
		t.Fatal("duplicate notice on retry")
	}
	e.publicProgress.Flush(context.Background())
	if visible := platform.task(id); visible == nil || visible.AuthorizationNoticeVersion != policy.Version+1 {
		t.Fatal("recovered notice did not reach task card")
	}
	if err := e.CheckTaskAuthorization(task, "task.resume"); err == nil {
		t.Fatal("recovery accepted stale decision")
	}
	if err := e.proactiveAuthorization.Revoke(d.ID, "owner:stop"); err != nil {
		t.Fatal(err)
	}
	if err := e.SyncAuthorizationNotices(); err != nil {
		t.Fatal(err)
	}
	task, _ = e.publicProgress.Task(id)
	if !task.AuthorizationWithdrawn || task.Seq != seq+1 {
		t.Fatal("withdrawal notice missing")
	}
	e.publicProgress.Flush(context.Background())
	if visible := platform.task(id); visible == nil || !visible.AuthorizationWithdrawn {
		t.Fatal("withdrawal did not requeue previously delivered card")
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

func TestProactiveEngineDecisionCannotCrossTaskSessionOrRole(t *testing.T) {
	a, c := authorizationFixture(t, ProactiveAuto)
	e := NewEngine("role", &stubAgent{}, nil, "", LangEnglish)
	e.proactiveAuthorization = a
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	task := &Task{ID: "task", Agent: "role", SessionKey: "other-room", State: TaskStateInProgress}
	if err := e.AdmitProactiveTask(d.ID, task, "backend"); err == nil {
		t.Fatal("grant crossed source session")
	}
	task.SessionKey = c.SessionKey
	if err := e.AdmitProactiveTask(d.ID, task, "backend"); err != nil {
		t.Fatal(err)
	}
	task.Agent = "other-role"
	if err := e.CheckTaskAuthorization(task, "message.send"); err == nil {
		t.Fatal("grant changed role without reassignment")
	}
	task.Agent, task.SessionKey = "role", "other-room"
	if err := e.CheckTaskAuthorization(task, "message.send"); err == nil {
		t.Fatal("grant crossed session after admission")
	}
}

func TestProactiveTaskContinuationRevalidatesAndStopPersists(t *testing.T) {
	for _, action := range []string{"policy", "cancel"} {
		t.Run(action, func(t *testing.T) {
			p, platform, run, id := taskRelayFixture(t)
			a, c := authorizationFixture(t, ProactiveAuto)
			policy := a.Policy()
			policy.Rules[0].SessionKey = "discord:room:user"
			if err := a.ReplacePolicy(policy.Version, policy); err != nil {
				t.Fatal(err)
			}
			c.SessionKey = "discord:room:user"
			e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangEnglish)
			e.publicProgress, e.proactiveAuthorization = p, a
			p.checkAuthorization, p.revokeAuthorization = e.CheckTaskAuthorization, e.revokeCancelledTask
			d, err := a.Evaluate(c)
			if err != nil {
				t.Fatal(err)
			}
			task, _ := p.Task(id)
			if err := e.AdmitProactiveTask(d.ID, task, "backend"); err != nil {
				t.Fatal(err)
			}
			p.finish(run, "result")
			// A follow-up may continue when its original authority is valid.
			next := p.begin(platform, c.SessionKey, LangEnglish, nil)
			if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: c.SessionKey, Run: next, Seq: 2, Kind: "update", Summary: "Continue authorized work"}); err != nil {
				t.Fatal(err)
			}
			if action == "cancel" {
				p.finish(next, "cancelled")
				reloaded, err := OpenProactiveAuthorization(a.path)
				if err != nil {
					t.Fatal(err)
				}
				if err := reloaded.Check(d.ID, "task.resume"); err == nil {
					t.Fatal("cancelled decision revived after restart")
				}
				return
			}
			p.finish(next, "result")
			policy = a.Policy()
			policy.Mode = ProactiveOff
			if err := a.ReplacePolicy(policy.Version, policy); err != nil {
				t.Fatal(err)
			}
			next = p.begin(platform, c.SessionKey, LangEnglish, nil)
			if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: c.SessionKey, Run: next, Seq: 3, Kind: "update", Summary: "Must not resume stale authority"}); err == nil {
				t.Fatal("task continuation bypassed current policy")
			}
		})
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

func TestManagementProactiveRequiresConfiguredAuthentication(t *testing.T) {
	_, server, e := testManagementServer(t, "")
	e.SetDataDir(t.TempDir())
	for _, path := range []string{"", "/policy"} {
		resp, err := server.Client().Get(server.URL + "/api/v1/projects/test-project/authorization" + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("tokenless management exposed authorization: %d", resp.StatusCode)
		}
	}
}
