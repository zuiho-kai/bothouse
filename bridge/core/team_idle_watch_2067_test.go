package core

import (
	"testing"
	"time"
)

// forgetTurnFact clears the process-wide turn fact for key: these tests share the key the
// watch fixture claims, and a lastEnd left by another test would count as "the wake was
// consumed" here.
func forgetTurnFact(key string) {
	teamTurns.mu.Lock()
	delete(teamTurns.by, key)
	delete(teamTurns.lastEnd, key)
	delete(teamTurns.failNext, key)
	teamTurns.mu.Unlock()
}

// #2067: between two wakes the workspace was running a bgrun CI. The live run is work, so the
// watch must not set Reported (the escalation to the chat's primary role).
func TestIdleEscalationWaitsForLiveBackgroundRun(t *testing.T) {
	e, _, _, h := watchFixture(t, "", "CI 还在跑")
	forgetTurnFact("discord:ws1")
	trackedRunFixture(t, e, time.Now().Add(-2*watchCheckAfter()))
	h.Idle = watchIdleState{Ended: time.Now().Add(-time.Minute), Wakes: 2, Woke: time.Now().Add(-10 * time.Minute)}
	if _, ok := e.updateIdle(idleAssignment{"discord:ws1", h, false}, func(row *TeamHandoff) { row.Idle = h.Idle }); !ok {
		t.Fatal("seed idle state failed")
	}

	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})

	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Reported {
		t.Fatalf("live bgrun was reported as stopped: %+v", got.Idle)
	}
	if got.Idle.Wakes != 2 {
		t.Fatalf("wakes = %d, want 2 (a live run sends no wake and no escalation)", got.Idle.Wakes)
	}
}

// #2067: a wake posted before a restart has not been consumed by the new process. The restart
// window (startedAt after Woke) is work in flight, not a stop.
func TestIdleEscalationWaitsForRestartWindow(t *testing.T) {
	e, _, _, h := watchFixture(t, "", "重启后还没接手")
	forgetTurnFact("discord:ws1")
	e.startedAt = time.Now() // this process started after the wake was posted
	h.Idle = watchIdleState{Ended: time.Now().Add(-time.Minute), Wakes: 2, Woke: time.Now().Add(-10 * time.Minute)}
	if _, ok := e.updateIdle(idleAssignment{"discord:ws1", h, false}, func(row *TeamHandoff) { row.Idle = h.Idle }); !ok {
		t.Fatal("seed idle state failed")
	}

	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})

	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Reported {
		t.Fatalf("restart window was reported as stopped: %+v", got.Idle)
	}
	if got.Idle.Wakes != 2 {
		t.Fatalf("wakes = %d, want 2 (waiting does not send another wake)", got.Idle.Wakes)
	}
}

// #2067: the wake was taken up (its turn ended) and no new work runs, so the escalation is
// real and must still happen. This is the control for the two waits above.
func TestIdleEscalationAfterWakeConsumed(t *testing.T) {
	e, _, _, h := watchFixture(t, "", "叫过了还是没交回")
	forgetTurnFact("discord:ws1")
	ended := time.Now()
	end := beginTeamTurn(teamTurnFact{Chat: "discord:ws1"})
	end() // a turn ended after the wake: it was consumed
	e.startedAt = ended.Add(-time.Hour)
	h.Idle = watchIdleState{Ended: ended.Add(-time.Minute), Wakes: 2, Woke: ended.Add(-time.Second)}
	if _, ok := e.updateIdle(idleAssignment{"discord:ws1", h, false}, func(row *TeamHandoff) { row.Idle = h.Idle }); !ok {
		t.Fatal("seed idle state failed")
	}

	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})

	if got := handoffsOf(e, "discord:ws1")[0]; !got.Idle.Reported {
		t.Fatalf("consumed wake with no handback was not escalated: %+v", got.Idle)
	}
}

// #2067: the wake is still on its way (no turn fact, no locked session yet). A wake inside the
// settle grace is not a stop: the watch looks again instead of stacking the second wake and
// escalating 15s later.
func TestIdleEscalationWaitsForWakeInTransit(t *testing.T) {
	e, _, _, h := watchFixture(t, "", "唤醒还在路上")
	forgetTurnFact("discord:ws1")
	e.startedAt = time.Now().Add(-time.Hour)
	h.Idle = watchIdleState{Ended: time.Now().Add(-2 * time.Minute), Wakes: 2, Woke: time.Now().Add(-30 * time.Second)}
	if _, ok := e.updateIdle(idleAssignment{"discord:ws1", h, false}, func(row *TeamHandoff) { row.Idle = h.Idle }); !ok {
		t.Fatal("seed idle state failed")
	}

	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})

	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Reported {
		t.Fatalf("wake in transit was reported as stopped: %+v", got.Idle)
	}
	if got.Idle.Wakes != 2 {
		t.Fatalf("wakes = %d, want 2 (the grace waits, it does not stack a wake)", got.Idle.Wakes)
	}
}

// #2067: the grace is a wait, not a park: a wake nobody took up and no work running is still a
// stop once the grace is over. This is the control for TestIdleEscalationWaitsForWakeInTransit.
func TestIdleEscalationAfterWakeGraceExpires(t *testing.T) {
	e, _, _, h := watchFixture(t, "", "叫了也没人接")
	forgetTurnFact("discord:ws1")
	e.startedAt = time.Now().Add(-time.Hour)
	h.Idle = watchIdleState{Ended: time.Now().Add(-4 * time.Minute), Wakes: 2, Woke: time.Now().Add(-3 * time.Minute)}
	if _, ok := e.updateIdle(idleAssignment{"discord:ws1", h, false}, func(row *TeamHandoff) { row.Idle = h.Idle }); !ok {
		t.Fatal("seed idle state failed")
	}

	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})

	got := handoffsOf(e, "discord:ws1")[0]
	if !got.Idle.Reported {
		t.Fatalf("unconsumed wake past the grace was not escalated: %+v", got.Idle)
	}
	if got.Idle.Wakes != 2 {
		t.Fatalf("wakes = %d, want 2 (an escalation sends no wake)", got.Idle.Wakes)
	}
}

// #2067: the wake was accepted but the turn fact is not written yet (the old agent process is
// still closing). The locked workspace session is work in flight, even after the grace.
func TestIdleEscalationWaitsForLockedWorkspaceSession(t *testing.T) {
	e, _, _, h := watchFixture(t, "", "上一轮还没关完")
	forgetTurnFact("discord:ws1")
	e.startedAt = time.Now().Add(-time.Hour)
	s := e.sessions.GetOrCreateActive("discord:ws1")
	if !s.TryLock() {
		t.Fatal("fixture session already busy")
	}
	defer s.Unlock()
	h.Idle = watchIdleState{Ended: time.Now().Add(-time.Minute), Wakes: 2, Woke: time.Now().Add(-10 * time.Minute)}
	if _, ok := e.updateIdle(idleAssignment{"discord:ws1", h, false}, func(row *TeamHandoff) { row.Idle = h.Idle }); !ok {
		t.Fatal("seed idle state failed")
	}

	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})

	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.Reported {
		t.Fatalf("locked workspace session was reported as stopped: %+v", got.Idle)
	}
}
