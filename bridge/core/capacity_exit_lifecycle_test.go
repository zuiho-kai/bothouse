package core

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Match an exec adapter: it reports capacity and exits, unlike the existing
// capacityScriptSession whose Alive always returns true.
type capacityExitSession struct {
	*capacityScriptSession
	exited atomic.Bool
}

func (s *capacityExitSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	s.exited.Store(true)
	s.events <- Event{Type: EventError, Error: errors.New("Selected model is at capacity. Please try a different model.")}
	return nil
}

func (s *capacityExitSession) Alive() bool { return !s.exited.Load() }

type capacityExitAgent struct {
	stubAgent
	failed    *capacityExitSession
	recovered *capacityScriptSession
	starts    atomic.Int32
}

func (a *capacityExitAgent) StartSession(context.Context, string) (AgentSession, error) {
	if a.starts.Add(1) == 1 {
		return a.failed, nil
	}
	return a.recovered, nil
}

func TestCapacityRetry_ExitedProcessDoesNotRejectSecondRedelivery(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = time.Hour // Fire the held deliveries explicitly, without a timer race.
	t.Cleanup(func() { capacityCooldownBase = old })
	p := &stubPlatformEngine{n: "test"}
	a := &capacityExitAgent{
		failed:    &capacityExitSession{capacityScriptSession: &capacityScriptSession{events: make(chan Event, 1)}},
		recovered: &capacityScriptSession{events: make(chan Event, 2), script: []string{"background", "human"}},
	}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "test:capacity-exit"
	background := &Message{SessionKey: key, Platform: p.Name(), UserID: "timer", Content: "background check", ReplyCtx: "ctx", turnTrigger: TurnTriggerTimer}
	e.handleMessage(p, background)
	session := e.sessions.GetOrCreateActive(key)
	waitFor(t, "failed turn to hold and unlock", func() bool {
		return e.capacityWait() > 0 && !session.Busy()
	})
	e.interactiveMu.Lock()
	previous := e.interactiveStates[key]
	deadRetained := previous != nil && previous.agentSession != nil && !previous.agentSession.Alive()
	e.interactiveMu.Unlock()
	t.Logf("after capacity error: retained dead process=%v", deadRetained)
	if out := joined(p); strings.Contains(out, "自动重试") {
		t.Fatalf("background check promised a reply: %s", out)
	}

	// Pause the first redelivery at the actual startup boundary, after it
	// installs its queue state and takes the lock, before its worker runs.
	e.ensureInteractiveStateForQueueing(key, p, background.ReplyCtx)
	if !session.TryLock() {
		t.Fatal("first redelivery could not acquire idle session")
	}
	e.capMu.Lock()
	e.capUntil = time.Time{}
	e.capPending = nil
	e.capMu.Unlock()
	human := &Message{SessionKey: key, Platform: p.Name(), UserID: "person", Content: mentionedNote + "\nplease reply", Mentioned: true, ReplyCtx: "ctx"}
	e.redeliverMessage(p, human, a, e.sessions, key, "")
	if out := joined(p); strings.Contains(out, "这条没能重试") {
		session.Unlock()
		t.Fatalf("second redelivery rejected behind exited process before replacement startup: %s", out)
	}
	e.processInteractiveMessageWith(p, background, session, a, e.sessions, key, "", key)
	if out := joined(p); !strings.Contains(out, "reply:human") {
		t.Fatalf("held human message has no business reply: %s", out)
	}
	for _, prompt := range a.recovered.sentPrompts() {
		if strings.Contains(prompt, "please reply") && !strings.Contains(prompt, mentionedNote) {
			t.Fatal("human redelivery lost must-reply instruction")
		}
	}
}
