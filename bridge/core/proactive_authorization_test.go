package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func authorizationFixture(t *testing.T, mode ProactiveMode) (*ProactiveAuthorization, ProactiveCandidate) {
	t.Helper()
	a, err := OpenProactiveAuthorization(filepath.Join(t.TempDir(), "authority.json"))
	if err != nil {
		t.Fatal(err)
	}
	p := ProactivePolicy{Mode: mode, Authority: "admin:settings", Bindings: []AuthorityBinding{{Principal: "owner", Identities: []AuthorityIdentity{{Platform: "discord", UserID: "123"}}}}, Rules: []ProactiveRule{{ID: "follow-up", Source: "event-source", Principal: "owner", SessionKey: "room", EventKind: "condition_met", Scopes: []string{"task.resume", "message.send"}}}}
	if err = a.ReplacePolicy(0, p); err != nil {
		t.Fatal(err)
	}
	c := ProactiveCandidate{EventID: "event-1", Source: "event-source", EventKind: "condition_met", Identity: AuthorityIdentity{"discord", "123"}, SessionKey: "room", Scopes: []string{"task.resume", "message.send"}, ActorKind: "human", Intent: "inferred", Authenticated: true, Visible: true}
	return a, c
}
func TestProactiveAuthorizationModes(t *testing.T) {
	for _, mode := range []ProactiveMode{ProactiveOff, ProactiveObserve, ProactiveAuto} {
		t.Run(string(mode), func(t *testing.T) {
			a, c := authorizationFixture(t, mode)
			d, err := a.Evaluate(c)
			if err != nil {
				t.Fatal(err)
			}
			want := map[ProactiveMode]string{ProactiveOff: "off", ProactiveObserve: "would_accept", ProactiveAuto: "eligible"}[mode]
			if d.Outcome != want {
				t.Fatalf("%+v", d)
			}
			err = a.Admit(d.ID, "task-1", "role", "backend", "workspace")
			if (err == nil) != (mode == ProactiveAuto) {
				t.Fatalf("admission %v", err)
			}
			if mode != ProactiveAuto && a.BeginEffect(d.ID, "message.send", "send-1") == nil {
				t.Fatal("non-auto effect allowed")
			}
			c.Intent = "explicit"
			e, err := a.Evaluate(c)
			if err != nil || e.Outcome != "explicit_path" {
				t.Fatalf("explicit path: %+v %v", e, err)
			}
			if a.Admit(e.ID, "explicit-task", "role", "backend", "workspace") == nil {
				t.Fatal("explicit path bypassed original permissions")
			}
		})
	}
}
func TestProactiveAuthorizationUntrustedCandidates(t *testing.T) {
	for _, mutate := range []func(*ProactiveCandidate){func(c *ProactiveCandidate) { c.Authenticated = false }, func(c *ProactiveCandidate) { c.Visible = false }, func(c *ProactiveCandidate) { c.ContextOnly = true }, func(c *ProactiveCandidate) { c.ActorKind = "bot" }, func(c *ProactiveCandidate) { c.ActorKind = "relayed" }, func(c *ProactiveCandidate) { c.Identity.Platform = "qq" }, func(c *ProactiveCandidate) { c.Scopes = []string{"shell.execute"} }, func(c *ProactiveCandidate) { c.Source = "wiki" }} {
		a, c := authorizationFixture(t, ProactiveAuto)
		mutate(&c)
		d, err := a.Evaluate(c)
		if err != nil {
			t.Fatal(err)
		}
		if d.Outcome != "denied" {
			t.Fatalf("untrusted %+v admitted: %+v", c, d)
		}
	}
	var c ProactiveCandidate
	if err := json.Unmarshal([]byte(`{"authenticated":true,"visible":true}`), &c); err != nil {
		t.Fatal(err)
	}
	if c.Authenticated || c.Visible {
		t.Fatal("payload forged trust")
	}
}
func TestProactiveAuthorizationPolicyChangesAtEveryBoundary(t *testing.T) {
	for _, stage := range []string{"evaluating", "queued", "executing", "resuming"} {
		t.Run(stage, func(t *testing.T) {
			a, c := authorizationFixture(t, ProactiveAuto)
			d, err := a.Evaluate(c)
			if err != nil {
				t.Fatal(err)
			}
			if stage != "evaluating" {
				if err = a.Admit(d.ID, "task", "role", "backend", "room"); err != nil {
					t.Fatal(err)
				}
			}
			if stage == "executing" {
				if err = a.BeginEffect(d.ID, "message.send", "inflight"); err != nil {
					t.Fatal(err)
				}
			}
			p := a.Policy()
			p.Rules = nil
			if err = a.ReplacePolicy(p.Version, p); err != nil {
				t.Fatal(err)
			}
			if !errors.Is(a.Admit(d.ID, "task", "role", "backend", "room"), ErrAuthorizationStale) {
				t.Fatal("stale evaluation accepted")
			}
			if !errors.Is(a.Check(d.ID, "task.resume"), ErrAuthorizationStale) {
				t.Fatal("stale queue executed")
			}
			if !errors.Is(a.Reassign(d.ID, "task", "role", "new-model", "other-workspace"), ErrAuthorizationStale) {
				t.Fatal("stale resume allowed")
			}
			if !errors.Is(a.BeginEffect(d.ID, "message.send", "next"), ErrAuthorizationStale) {
				t.Fatal("effect allowed after source disabled")
			}
			if stage == "executing" {
				if err = a.FinishEffect("inflight", "delivered before cancellation"); err != nil {
					t.Fatal(err)
				}
			}
			b, _ := a.Snapshot()
			var s authorizationState
			_ = json.Unmarshal(b, &s)
			if stage != "evaluating" && len(s.Notices) != 1 {
				t.Fatalf("missing task notification: %s", b)
			}
		})
	}
}
func TestProactiveAuthorizationRestartMigrationStopAndDedup(t *testing.T) {
	a, c := authorizationFixture(t, ProactiveAuto)
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Admit(d.ID, "task", "role", "model-a", "old-room"); err != nil {
		t.Fatal(err)
	}
	a, err = OpenProactiveAuthorization(a.path)
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.Evaluate(c)
	if err != nil || again.ID != d.ID || !again.CreatedAt.Equal(d.CreatedAt) {
		t.Fatal("decision changed on restart")
	}
	if err = a.Reassign(d.ID, "task", "role", "model-b", "new-workspace"); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(a.Admit(d.ID, "other-task", "role", "model-b", "new-workspace"), ErrAuthorizationDuplicate) {
		t.Fatal("event admitted twice")
	}
	if err = a.Revoke(d.ID, "human:stop"); err != nil {
		t.Fatal(err)
	}
	a, err = OpenProactiveAuthorization(a.path)
	if err != nil {
		t.Fatal(err)
	}
	if a.Reassign(d.ID, "task", "role", "model-c", "room") == nil {
		t.Fatal("stopped task resurrected")
	}
	p := a.Policy()
	if err = a.ReplacePolicy(p.Version, p); err != nil {
		t.Fatal(err)
	}
	newer, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	if !errors.Is(a.Admit(newer.ID, "new-task", "role", "model-c", "room"), ErrAuthorizationDuplicate) {
		t.Fatal("policy refresh resurrected stopped source event")
	}
}
func TestProactiveAuthorizationBindingsAllPlatforms(t *testing.T) {
	for _, platform := range []string{"discord", "qq", "feishu", "cloud_web"} {
		t.Run(platform, func(t *testing.T) {
			a, c := authorizationFixture(t, ProactiveAuto)
			c.Identity.Platform = platform
			p := a.Policy()
			p.Bindings[0].Identities = []AuthorityIdentity{c.Identity}
			if err := a.ReplacePolicy(p.Version, p); err != nil {
				t.Fatal(err)
			}
			d, err := a.Evaluate(c)
			if err != nil || d.Outcome != "eligible" {
				t.Fatalf("%+v %v", d, err)
			}
		})
	}
}
func TestProactiveAuthorizationConcurrentAdmissionAndImmutableDecisions(t *testing.T) {
	a, c := authorizationFixture(t, ProactiveAuto)
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	d.Scopes[0] = "shell.execute"
	c.Scopes[0] = "shell.execute"
	var wg sync.WaitGroup
	for _, id := range []string{"task-a", "task-b"} {
		wg.Add(1)
		go func(id string) { defer wg.Done(); _ = a.Admit(d.ID, id, "role", "backend", "room") }(id)
	}
	wg.Wait()
	if a.Check(d.ID, "shell.execute") == nil {
		t.Fatal("caller mutated immutable decision")
	}
	b, _ := a.Snapshot()
	var s authorizationState
	_ = json.Unmarshal(b, &s)
	if len(s.Assignments) != 1 {
		t.Fatal("duplicate concurrent admission")
	}
	if err = a.BeginEffect(d.ID, "message.send", "one"); err != nil {
		t.Fatal(err)
	}
	if a.BeginEffect(d.ID, "message.send", "one") == nil {
		t.Fatal("duplicate in-flight effect")
	}
}
func TestProactiveAuthorizationDiskFailureFailsClosed(t *testing.T) {
	a, c := authorizationFixture(t, ProactiveAuto)
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	// Replace the destination with a directory without deleting anything.
	if err = os.Rename(a.path, a.path+".saved"); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(a.path, 0700); err != nil {
		t.Fatal(err)
	}
	if a.Admit(d.ID, "task", "role", "backend", "room") == nil {
		t.Fatal("failed durable write accepted")
	}
	if a.Check(d.ID, "message.send") == nil {
		t.Fatal("failed write granted execution in memory")
	}
}
