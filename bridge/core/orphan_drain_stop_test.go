package core

import (
	"sync"
	"testing"
	"time"
)

// countingResultSession answers every Send with one result and counts sends
// under a lock so tests can read the count while engine goroutines run.
type countingResultSession struct {
	mu      sync.Mutex
	sends   int
	prompts []string
	events  chan Event
}

func newCountingResultSession() *countingResultSession {
	return &countingResultSession{events: make(chan Event, 16)}
}

func (s *countingResultSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.sends++
	s.prompts = append(s.prompts, prompt)
	s.mu.Unlock()
	s.events <- Event{Type: EventResult, Content: "done", Done: true}
	return nil
}
func (s *countingResultSession) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sends
}
func (s *countingResultSession) sentPrompts() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.prompts...)
}
func (s *countingResultSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *countingResultSession) Events() <-chan Event                             { return s.events }
func (s *countingResultSession) CurrentSessionID() string                         { return "counting" }
func (s *countingResultSession) Alive() bool                                      { return true }
func (s *countingResultSession) Close() error                                     { return nil }

// conest #14: once the engine is stopping, the busy-session race guard must
// not start an untracked drain. The orphaned queue stays undelivered and the
// session lock taken by the guard is released.
func TestQueueForBusySession_EngineStopping_NoOrphanDrain(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	as := newCountingResultSession()
	e := NewEngine("test", &resultAgent{}, []Platform{p}, "", LangEnglish)
	defer e.cancel()

	key := "test:channel-1:user-1"
	session, _ := busySessionWithLiveState(t, e, p, key, as)
	session.Unlock() // the running turn has just ended

	e.platformLifecycleMu.Lock()
	e.stopping = true
	e.platformLifecycleMu.Unlock()

	msg := &Message{SessionKey: key, Platform: "test", UserID: "u1", UserName: "u1", Content: "late", ReplyCtx: "rctx"}
	if got := e.queueForBusySession(p, msg, session, e.sessions, key, e.agent, "", nil); got != queueAccepted {
		t.Fatalf("queueForBusySession() = %v, want queueAccepted", got)
	}
	time.Sleep(200 * time.Millisecond)
	if n := as.count(); n != 0 {
		t.Fatalf("agent got %d sends after engine began stopping, want 0", n)
	}
	if !session.TryLock() {
		t.Fatal("session left locked after the stopping engine refused the drain")
	}
	session.Unlock()
}

// Stop racing the race-guard path must not panic (WaitGroup Add during Wait)
// and no queued turn may reach the agent after Stop has returned. Run with -race.
func TestQueueForBusySession_ConcurrentStop_NoSendAfterStop(t *testing.T) {
	for i := 0; i < 50; i++ {
		p := &stubPlatformEngine{n: "test"}
		as := newCountingResultSession()
		e := NewEngine("test", &resultAgent{}, []Platform{p}, "", LangEnglish)

		key := "test:channel-1:user-1"
		session, _ := busySessionWithLiveState(t, e, p, key, as)
		session.Unlock()

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			msg := &Message{SessionKey: key, Platform: "test", UserID: "u1", UserName: "u1", Content: "late", ReplyCtx: "rctx"}
			e.queueForBusySession(p, msg, session, e.sessions, key, e.agent, "", nil)
		}()
		go func() {
			defer wg.Done()
			_ = e.Stop()
		}()
		wg.Wait()
		after := as.count()
		time.Sleep(20 * time.Millisecond)
		if n := as.count(); n != after {
			t.Fatalf("iteration %d: agent got a send after Stop returned (%d -> %d)", i, after, n)
		}
	}
}
