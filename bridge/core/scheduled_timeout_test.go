package core

import (
	"testing"
	"time"
)

// A scheduled run that timed out stops the turn it started; a run that only queued
// (registered nothing) never stops someone else's turn.
func TestStopScheduledTurn(t *testing.T) {
	e := NewEngine("p", &stubAgent{}, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangEnglish)
	f := &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
	addBusyState(e, f, "discord:c1")
	addBusyState(e, f, "discord:c2")

	e.noteScheduledTurn("job1", "discord:c1")
	if !e.StopScheduledTurn("job1") {
		t.Fatal("timed-out scheduled turn was not stopped")
	}
	if !f.stopped(t, "p|discord:c1") {
		t.Fatal("agent turn kept running after timeout")
	}
	if e.StopScheduledTurn("job1") {
		t.Fatal("stopped twice")
	}
	if e.StopScheduledTurn("queued-job") || f.stopped(t, "p|discord:c2") {
		t.Fatal("a run that never started a turn stopped another turn")
	}

	e.noteScheduledTurn("job2", "discord:c2")
	e.forgetScheduledTurn("job2", "discord:c2")
	if e.StopScheduledTurn("job2") {
		t.Fatal("finished run still stoppable")
	}
}

// 11-14 deep: a queued cron turn's 30m limit fired after that turn ended and its state was
// replaced; the stop by session key cancelled the next cron turn. The limit stops only the turn
// it was armed for, and still stops that turn when it really runs over.
func TestScheduledTurnTimeoutStopsOnlyItsOwnTurn(t *testing.T) {
	e := NewEngine("p", &stubAgent{}, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangEnglish)
	f := &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
	const key = "discord:c1"

	addBusyState(e, f, key)
	old := e.interactiveStates[key]
	old.scheduledWatch = 7
	// The queued turn ended and its agent process closed: the next turn runs on a new state.
	addBusyState(e, f, key)
	if e.fireScheduledTurnTimeout(old, key, 7, TurnTriggerCron, "", "job", 0) || f.stopped(t, "p|"+key) {
		t.Fatal("an ended turn's time limit stopped the next turn on the session")
	}

	cur := e.interactiveStates[key]
	cur.scheduledWatch = 8
	if e.fireScheduledTurnTimeout(cur, key, 7, TurnTriggerCron, "", "job", 0) {
		t.Fatal("a stale token on the live state stopped its turn")
	}
	if !e.fireScheduledTurnTimeout(cur, key, 8, TurnTriggerCron, "", "job", 0) || !f.stopped(t, "p|"+key) {
		t.Fatal("the turn that really ran over its limit was not stopped")
	}
}

// blockingCancelSession holds CancelTurn open until released, like an ACP session/cancel still
// on its way, so a test can start the next turn while a limit's cancel is in flight.
type blockingCancelSession struct {
	*abortTurnSession
	entered chan struct{}
	release chan struct{}
}

func (s *blockingCancelSession) CancelTurn() error {
	close(s.entered)
	<-s.release
	return s.abortTurnSession.CancelTurn()
}

// Review 11-14 (G哥): the limit passed its token check, then the next turn started on the same
// state (queued turns reuse it) before the ACP cancel went out, and the cancel hit that turn.
// The next turn's start now waits until the claimed cancel is done, and does not inherit its
// cancelled flag; the stale token cannot fire again.
func TestScheduledTurnTimeoutCancelDoesNotReachNextTurnOnSameState(t *testing.T) {
	e := NewEngine("p", &stubAgent{}, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangEnglish)
	const key = "discord:c1"
	sess := &blockingCancelSession{abortTurnSession: &abortTurnSession{events: make(chan Event, 8)}, entered: make(chan struct{}), release: make(chan struct{})}
	state := &interactiveState{agentSession: sess}
	state.scheduledWatch = 7
	e.interactiveStates[key] = state

	fired := make(chan bool, 1)
	go func() { fired <- e.fireScheduledTurnTimeout(state, key, 7, TurnTriggerCron, "", "job", 0) }()
	<-sess.entered // token check passed; the cancel for the old turn is in flight

	started := make(chan struct{})
	go func() { // the old turn ended; the next turn on the same state starts
		e.armScheduledTurnTimeout(state, key, "", "", "", "", true)
		close(started)
	}()
	select {
	case <-started:
		t.Fatal("the next turn started while the old turn's cancel was in flight")
	case <-time.After(50 * time.Millisecond):
	}
	close(sess.release)
	if !<-fired {
		t.Fatal("the turn that ran over its limit was not stopped")
	}
	<-started
	state.mu.Lock()
	cancelled := state.turnCancelled
	state.mu.Unlock()
	if cancelled {
		t.Fatal("the next turn inherited the old turn's cancel")
	}
	if e.fireScheduledTurnTimeout(state, key, 7, TurnTriggerCron, "", "job", 0) {
		t.Fatal("a spent token stopped the next turn")
	}
}
