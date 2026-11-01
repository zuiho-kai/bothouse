package core

import "testing"

// newAdmissionRegressionEngine builds an engine with an installed "auto" policy whose rule
// covers discord/room for user 123, mirroring the ingress test fixture.
func newAdmissionRegressionEngine(t *testing.T, platformName string) (*Engine, *proactiveIntakePlatform, *abortTurnSession) {
	t.Helper()
	p := &proactiveIntakePlatform{stubPlatformEngine: stubPlatformEngine{n: platformName}}
	backend := &abortTurnSession{events: make(chan Event, 8)}
	e := NewEngine("role", &abortTurnAgent{s: backend}, []Platform{p}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	a, _ := authorizationFixture(t, ProactiveAuto)
	policy := a.Policy()
	policy.Rules[0].Source, policy.Rules[0].EventKind = p.Name(), "message"
	if err := a.ReplacePolicy(policy.Version, policy); err != nil {
		t.Fatal(err)
	}
	e.proactiveAuthorization = a
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = e.Stop() })
	return e, p, backend
}

func TestProactiveRejectedAdmissionCannotResume(t *testing.T) {
	for _, recovering := range []bool{false, true} {
		e, p, backend := newAdmissionRegressionEngine(t, "discord")
		e.SetPaused(true)
		msg := &Message{Platform: p.Name(), MessageID: "rejected", UserID: "123", SessionKey: "room", Content: "do work", ReplyCtx: "ctx"}
		if recovering {
			d, _, err := e.evaluatePlatformFollowup(p, msg)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := e.admitPlatformTask(p, msg, d); err != nil {
				t.Fatal(err)
			}
			if err := e.resumeProactiveAdmission(p, msg); err != nil {
				t.Fatal(err)
			}
		} else {
			p.handler(p, msg)
		}
		if len(e.TurnJournal().List()) != 0 {
			t.Fatal("rejected admission remains recoverable")
		}
		task, ok := e.publicProgress.Task(msg.authorization.TaskID)
		if !ok || e.CheckTaskAuthorization(task, "task.resume") == nil {
			t.Fatal("rejected grant remains executable")
		}
		backend.mu.Lock()
		n := len(backend.prompts)
		backend.mu.Unlock()
		if n != 0 {
			t.Fatal("rejection executed")
		}
	}
}
func TestProactiveUnmatchedIntakePreservesOrdinaryRoute(t *testing.T) {
	for _, kind := range []string{"unbound", "unmatched-session"} {
		t.Run(kind, func(t *testing.T) {
			_, p, backend := newAdmissionRegressionEngine(t, "discord")
			msg := &Message{Platform: p.Name(), MessageID: kind, UserID: "123", SessionKey: "room", Content: "ordinary conversation", ReplyCtx: "ctx"}
			if kind == "unbound" {
				msg.UserID = "999"
			} else {
				msg.SessionKey = "another-room"
			}
			p.handler(p, msg)
			waitFor(t, "ordinary route", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return len(backend.prompts) == 1 })
			if msg.authorization != nil {
				t.Fatal("unmatched message received proactive grant")
			}
		})
	}
}

func TestProactiveOffObservePreserveOrdinaryGate(t *testing.T) {
	for _, mode := range []ProactiveMode{ProactiveOff, ProactiveObserve} {
		t.Run(string(mode), func(t *testing.T) {
			e, p, backend := newAdmissionRegressionEngine(t, "discord")
			a := e.proactiveAuthorization
			policy := a.Policy()
			policy.Mode = mode
			if err := a.ReplacePolicy(policy.Version, policy); err != nil {
				t.Fatal(err)
			}
			e.SetGate(replyWhenMentioned(t).URL, 2000, "context")
			e.SetGateBurstWindow(1)
			msg := &Message{Platform: p.Name(), MessageID: "ordinary-context", UserID: "123", SessionKey: "room", Content: "ordinary conversation", ReplyCtx: "ctx"}
			p.handler(p, msg)
			waitFor(t, "ordinary gate buffers unaddressed message", func() bool {
				e.gate.mu.Lock()
				defer e.gate.mu.Unlock()
				for _, buffered := range e.gate.gbuf {
					if len(buffered) > 0 {
						return true
					}
				}
				return false
			})
			backend.mu.Lock()
			count := len(backend.prompts)
			backend.mu.Unlock()
			if count != 0 || len(p.getSent()) != 0 || msg.authorization != nil {
				t.Fatal("observation bypassed the ordinary gate")
			}
			explicit := &Message{Platform: p.Name(), MessageID: "explicit-request", UserID: "123", SessionKey: "room", Content: "please reply", ReplyCtx: "ctx", Mentioned: true}
			p.handler(p, explicit)
			waitFor(t, "explicit request still executes", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return len(backend.prompts) == 1 })
			if explicit.authorization != nil {
				t.Fatal("explicit request acquired inferred authority")
			}
			e.publicProgress.mu.Lock()
			defer e.publicProgress.mu.Unlock()
			if len(e.publicProgress.records) != 0 {
				t.Fatal("off/observe created proactive task")
			}
		})
	}
}
