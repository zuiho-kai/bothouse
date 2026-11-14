package core

import "testing"

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
