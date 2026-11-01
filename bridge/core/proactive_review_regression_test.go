package core

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestIndependent751QueuedRevocationHasTerminalFact(t *testing.T) {
	e, p, backend := newAdmissionRegressionEngine(t, "discord")
	explicit := &Message{Platform: p.Name(), MessageID: "explicit-running", UserID: "123", SessionKey: "room", Content: "first explicit task", ReplyCtx: "ctx", Mentioned: true}
	p.handler(p, explicit)
	waitFor(t, "first execution", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return len(backend.prompts) == 1 })
	msg := &Message{Platform: p.Name(), MessageID: "queued-inferred", UserID: "123", SessionKey: "room", Content: "second inferred task", ReplyCtx: "ctx"}
	p.handler(p, msg)
	if msg.authorization == nil {
		t.Fatal("missing admitted grant")
	}
	e.interactiveMu.Lock()
	state := e.interactiveStates["room"]
	e.interactiveMu.Unlock()
	waitFor(t, "inferred task queued", func() bool { state.mu.Lock(); defer state.mu.Unlock(); return len(state.pendingMessages) == 1 })
	if err := e.proactiveAuthorization.Revoke(msg.authorization.DecisionID, "human:stop"); err != nil {
		t.Fatal(err)
	}
	backend.events <- Event{Type: EventResult, Done: true, Content: "first explicit task complete"}
	waitFor(t, "queue refusal cancelled session", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return backend.cancels > 0 })
	waitFor(t, "event reader returned", func() bool { return !e.sessions.GetOrCreateActive("room").Busy() })
	if err := e.SyncAuthorizationNotices(); err != nil {
		t.Fatal(err)
	}
	task, ok := e.publicProgress.Task(msg.authorization.TaskID)
	if !ok {
		t.Fatal("admitted task missing")
	}
	backend.mu.Lock()
	starts := len(backend.prompts)
	backend.mu.Unlock()
	if starts != 1 {
		t.Fatalf("revoked queued task executed: sends=%d", starts)
	}
	state.mu.Lock()
	remaining := len(state.pendingMessages)
	state.mu.Unlock()
	t.Logf("queue=%d backend_sends=%d state=%s withdrawn=%v events=%+v", remaining, starts, task.State, task.AuthorizationWithdrawn, task.Events)
	if task.State != TaskStateFailed && task.State != TaskStateCancelled {
		t.Fatalf("revoked dequeued task has no failed/cancelled terminal fact: state=%s", task.State)
	}
}

func TestIndependent751PublicFactRequiresSendScope(t *testing.T) {
	for _, phase := range []string{"missing-scope", "revoked-before-flush", "revoked-after-card", "allowed"} {
		t.Run(phase, func(t *testing.T) {
			platform := &revokingProgressPlatform{progressTestPlatform: newProgressPlatform()}
			e := NewEngine("role", &stubAgent{}, []Platform{platform}, "", LangEnglish)
			e.SetDataDir(t.TempDir())
			defer e.Stop()
			if err := e.EnablePublicProgress(); err != nil {
				t.Fatal(err)
			}
			e.publicProgress.workspaceChat = func(string) bool { return true }
			a, c := authorizationFixture(t, ProactiveAuto)
			policy := a.Policy()
			scopes := []string{"task.resume"}
			if phase != "missing-scope" {
				scopes = append(scopes, "message.send")
			}
			policy.Rules[0].Scopes = scopes
			if err := a.ReplacePolicy(policy.Version, policy); err != nil {
				t.Fatal(err)
			}
			c.Scopes = scopes
			e.proactiveAuthorization = a
			d, err := a.Evaluate(c)
			if err != nil {
				t.Fatal(err)
			}
			msg := &Message{SessionKey: c.SessionKey}
			task, err := e.admitPlatformTask(platform, msg, d)
			if err != nil {
				t.Fatal(err)
			}
			if err := e.CheckTaskAuthorization(task, "message.send"); (err == nil) != (phase != "missing-scope") {
				t.Fatal("fixture permits sending")
			}
			token, err := e.beginProactiveProgress(msg.authorization, nil)
			if err != nil {
				t.Fatal(err)
			}
			const summary = "model-authored result without message.send grant"
			_, err = e.publicProgress.Report(PublicProgressRequest{Project: e.name, SessionKey: c.SessionKey, Run: token, Seq: 1, Kind: "result", Summary: summary})
			if err != nil {
				t.Fatal(err)
			}
			if phase == "revoked-before-flush" {
				if err := a.Revoke(d.ID, "owner"); err != nil {
					t.Fatal(err)
				}
			}
			if phase == "revoked-after-card" {
				platform.afterCard = func() error { return a.Revoke(d.ID, "owner") }
			}
			e.publicProgress.Flush(context.Background())
			stored, _ := e.publicProgress.Task(task.ID)
			if stored.ResultSummary != summary {
				t.Fatal("delivery projection destroyed durable result")
			}
			if phase != "revoked-after-card" {
				b, _ := json.Marshal(platform.task(task.ID))
				if strings.Contains(string(b), summary) != (phase == "allowed") {
					t.Fatalf("card send scope mismatch: %s", b)
				}
			}
			platform.pm.Lock()
			defer platform.pm.Unlock()
			found := false
			for _, ev := range platform.facts {
				if ev.Summary == summary {
					found = true
				}
			}
			if found != (phase == "allowed") {
				t.Fatalf("result fact send scope mismatch: phase=%s found=%v", phase, found)
			}
		})
	}
}

type revokingProgressPlatform struct {
	*progressTestPlatform
	afterCard func() error
}

func (p *revokingProgressPlatform) EnsureTaskCard(ctx context.Context, task *Task, lang Language) error {
	if err := p.progressTestPlatform.EnsureTaskCard(ctx, task, lang); err != nil {
		return err
	}
	if p.afterCard != nil {
		return p.afterCard()
	}
	return nil
}
