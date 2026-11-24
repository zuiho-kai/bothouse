package core

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// #2132: the orphan-queue drain took a message off the queue while a scheduled
// timeout was still closing the session, so the message was sent to the dying
// process and its sender got the adapter's raw error instead of the
// dropped-queue notice the rest of the queue received.

// drainDeadSession stands in for an agent process whose Close is already in
// flight: Alive() keeps reporting true until the test lets Close finish, and a
// Send that lands in that window fails the way a dead session's does.
type drainDeadSession struct {
	stubAgentSession
	mu           sync.Mutex
	dead         bool
	sends        int
	closeEntered chan struct{}
	closeRelease chan struct{}
	closeDone    chan struct{}
	sendEntered  chan struct{}
	sendGate     chan struct{}
}

func (s *drainDeadSession) Alive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.dead
}

func (s *drainDeadSession) Close() error {
	if s.closeEntered != nil {
		select {
		case <-s.closeEntered:
		default:
			close(s.closeEntered)
		}
	}
	if s.closeRelease != nil {
		<-s.closeRelease
	}
	s.mu.Lock()
	s.dead = true
	s.mu.Unlock()
	if s.closeDone != nil {
		close(s.closeDone)
	}
	return nil
}

func (s *drainDeadSession) Send(_ string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.sends++
	s.mu.Unlock()
	if s.sendEntered != nil {
		select {
		case s.sendEntered <- struct{}{}:
		default:
		}
	}
	if s.sendGate != nil {
		<-s.sendGate
	}
	s.mu.Lock()
	dead := s.dead
	s.mu.Unlock()
	if dead {
		return errors.New("write to dead session")
	}
	return nil
}

func (s *drainDeadSession) sendCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sends
}

func queuedDrainMessage(p Platform, key, id, user, content string) queuedMessage {
	return queuedMessage{platform: p, replyCtx: key, messageID: id, userID: user,
		content: content, msgPlatform: "discord", msgSessionKey: key}
}

// A queued message taken while a claimed scheduled-timeout cancel was still
// closing the session must not be sent to the dying process: the drain waits
// for the claimed cancel before taking the queue, so the message stays queued
// and gets the same dropped-queue notice as the rest.
func TestDrainPendingMessagesWaitsClaimedCancelBeforeDequeue(t *testing.T) {
	p := &stubPlatformEngine{n: "discord"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.cancel()

	key := "discord:c1"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("could not lock session to simulate a running turn")
	}
	as := &drainDeadSession{
		closeEntered: make(chan struct{}),
		closeRelease: make(chan struct{}),
		closeDone:    make(chan struct{}),
		sendEntered:  make(chan struct{}, 1),
		sendGate:     make(chan struct{}),
	}
	state := &interactiveState{
		agentSession:   as,
		platform:       p,
		replyCtx:       key,
		scheduledWatch: 7,
		pendingMessages: []queuedMessage{
			queuedDrainMessage(p, key, "m1", "u1", "first queued"),
			queuedDrainMessage(p, key, "m2", "u2", "second queued"),
		},
	}

	// The turn's time limit claims its cancel; holding interactiveMu keeps the
	// stop inside the claim, so the claim is in flight when the drain runs.
	e.interactiveMu.Lock()
	e.interactiveStates[key] = state
	fired := make(chan bool, 1)
	go func() { fired <- e.fireScheduledTurnTimeout(state, key, 7, TurnTriggerCron, "", "job", 0) }()
	waitFor(t, "scheduled cancel claimed", func() bool {
		state.mu.Lock()
		defer state.mu.Unlock()
		return state.scheduledCancel != nil
	})

	drainDone := make(chan bool, 1)
	go func() { drainDone <- e.drainPendingMessages(state, session, e.sessions, key) }()
	time.Sleep(100 * time.Millisecond) // let the drain reach the queue check
	e.interactiveMu.Unlock()
	if !<-fired {
		t.Fatal("the claimed cancel did not stop the session")
	}
	// Pre-fix the drain proceeded to send on the closing session; fixed, it
	// waited for the cancel first and found the queue already dropped — no
	// send happens and this just lets the drain finish below.
	select {
	case <-as.sendEntered:
	case <-time.After(500 * time.Millisecond):
	}
	close(as.closeRelease) // the closing process is now dead; a send in flight fails
	<-as.closeDone
	close(as.sendGate)
	if !<-drainDone {
		t.Fatal("drainPendingMessages did not release the session")
	}

	sent := joined(p)
	if strings.Contains(sent, "write to dead session") {
		t.Fatalf("the dequeued message's dead-session error reached the user: %q", sent)
	}
	if got := strings.Count(sent, "session reset"); got != 2 {
		t.Fatalf("want the dropped-queue notice for both queued messages, got %d in %q", got, sent)
	}
	if n := as.sendCount(); n != 0 {
		t.Fatalf("queued message was sent to the closing session (%d sends)", n)
	}
}

// A session the drain already checked can still die before the send lands —
// here, the process exits on its own. The dequeued message then ends like a
// dropped queued message, not as a turn error carrying the adapter's wording.
func TestDrainPendingMessagesSendOnDeadSessionGetsDropNotice(t *testing.T) {
	p := &stubPlatformEngine{n: "discord"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.cancel()

	key := "discord:c1"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("could not lock session to simulate a running turn")
	}
	as := &drainDeadSession{
		sendEntered: make(chan struct{}, 1),
		sendGate:    make(chan struct{}),
	}
	state := &interactiveState{
		agentSession: as, platform: p, replyCtx: key,
		pendingMessages: []queuedMessage{queuedDrainMessage(p, key, "m1", "u1", "queued")},
	}
	e.interactiveStates[key] = state

	drainDone := make(chan bool, 1)
	go func() { drainDone <- e.drainPendingMessages(state, session, e.sessions, key) }()
	select {
	case <-as.sendEntered:
	case <-time.After(5 * time.Second):
		t.Fatal("the dequeued message was never sent")
	}
	as.mu.Lock()
	as.dead = true // the process exits between the liveness check and the send
	as.mu.Unlock()
	close(as.sendGate)
	if !<-drainDone {
		t.Fatal("drainPendingMessages did not unlock the session")
	}

	sent := joined(p)
	if !strings.Contains(sent, "agent session ended") {
		t.Fatalf("want the dropped-queue notice for the dequeued message, got %q", sent)
	}
	if strings.Contains(sent, "write to dead session") {
		t.Fatalf("the dead-session send error reached the user instead of the drop notice: %q", sent)
	}
}
