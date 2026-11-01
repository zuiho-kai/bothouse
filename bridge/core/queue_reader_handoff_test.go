package core

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// Observe the reader handoff at the real AgentSession.Send boundary. Returning
// an error on overlap makes the regression deterministic rather than relying
// on which of two competing consumers wins the next EventResult.
type queueReaderCheckedSession struct {
	*cujAgentSession
	readerDone <-chan struct{}
	overlap    chan bool
}

func TestDrainPendingMessages_RechecksQueueBeforeIdleUnlock(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() {
		if err := e.Stop(); err != nil {
			t.Error(err)
		}
	})
	e.agentSessionIdleTimeoutNanos.Store(int64(time.Hour))
	key := "test:late-queued"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("session must start idle")
	}
	as := &queueReaderCheckedSession{cujAgentSession: newCUJAgentSession(), overlap: make(chan bool, 1)}
	state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx", eventsNeedResync: false}
	e.interactiveStates[key] = state
	// Re-arming idle close cancels its old timer outside state.mu. Use that
	// boundary to enqueue after the empty check and idle-reader start, but
	// before releasing the session. No sleeps or real timer expiry needed.
	state.agentSessionIdleCancel = func() {
		if !session.Busy() {
			t.Error("idle timer restored after session unlock")
		}
		state.mu.Lock()
		as.readerDone = state.unsolicitedDone
		state.mu.Unlock()
		msg := &Message{SessionKey: key, Platform: p.Name(), MessageID: "late",
			UserID: "user", Content: "late question", ReplyCtx: "ctx"}
		if !e.queueMessageForBusySession(p, msg, key) {
			t.Error("late input was not queued")
		}
	}
	if !e.drainPendingMessages(state, session, e.sessions, key) {
		t.Fatal("session not released")
	}
	select {
	case overlap := <-as.overlap:
		if overlap {
			t.Error("late queued input started before idle reader stopped")
		}
	default:
		t.Fatal("input arriving during idle handoff was stranded")
	}
	if session.Busy() {
		t.Error("session still busy after draining")
	}
	state.mu.Lock()
	timerArmed := state.agentSessionIdleCancel != nil
	state.mu.Unlock()
	if !timerArmed {
		t.Error("idle timer not restored after late input")
	}
	visible := strings.Join(p.getSent(), "\n")
	if !strings.Contains(visible, "ok") {
		t.Errorf("late reply missing: %s", visible)
	}
}

func (s *queueReaderCheckedSession) Send(prompt, id string, images []ImageAttachment, files []FileAttachment) error {
	select {
	case <-s.readerDone:
		s.overlap <- false
	default:
		s.overlap <- true
		return fmt.Errorf("queued Send overlaps the unsolicited reader")
	}
	return s.cujAgentSession.Send(prompt, id, images, files)
}

func TestDrainPendingMessages_StopsIdleReaderBeforeSending(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() {
		if err := e.Stop(); err != nil {
			t.Error(err)
		}
	})
	key := "test:queued"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("session must start idle")
	}
	as := &queueReaderCheckedSession{cujAgentSession: newCUJAgentSession(), overlap: make(chan bool, 3)}
	state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx", eventsNeedResync: false}
	e.interactiveStates[key] = state
	e.startUnsolicitedReader(state, session, e.sessions, key, "")
	state.mu.Lock()
	as.readerDone = state.unsolicitedDone
	state.mu.Unlock()
	// Match the late-arrival window: the foreground turn still owns the
	// session, an idle reader was started, and new messages enter its queue.
	for i := 0; i < 3; i++ {
		msg := &Message{SessionKey: key, Platform: p.Name(), MessageID: fmt.Sprint(i),
			UserID: fmt.Sprintf("user-%d", i), Content: fmt.Sprintf("queued-%d", i), ReplyCtx: "ctx"} // distinct senders: three separate turns, not one batch
		if !e.queueMessageForBusySession(p, msg, key) {
			t.Fatal("message was not queued")
		}
	}
	if !e.drainPendingMessages(state, session, e.sessions, key) {
		t.Fatal("session not released")
	}
	for i := 0; i < 3; i++ {
		select {
		case overlap := <-as.overlap:
			if overlap {
				t.Errorf("queued turn %d started before the idle reader stopped", i)
			}
		default:
			t.Errorf("queued turn %d was never sent", i)
		}
	}
	answers := 0
	for _, h := range session.GetHistory(0) {
		if h.Role == "assistant" && h.Content == "ok" {
			answers++
		}
	}
	if answers != 3 {
		t.Errorf("want 3 completed replies, got %d", answers)
	}
	visible := 0
	for _, reply := range p.getSent() {
		if strings.HasPrefix(reply, "ok") {
			visible++
		}
	}
	if visible != 3 {
		t.Errorf("want 3 platform replies, got %d", visible)
	}
	state.mu.Lock()
	idleDone := state.unsolicitedDone
	state.mu.Unlock()
	if idleDone == nil {
		t.Fatal("idle reader was not restored after draining")
	}
	select {
	case <-idleDone:
		t.Error("idle reader is stopped after draining")
	default:
	}
}
