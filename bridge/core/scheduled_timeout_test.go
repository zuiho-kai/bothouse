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
