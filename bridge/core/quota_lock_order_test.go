package core

import (
	"testing"
	"time"
)

// 2026-11-04: quotaTick held quotaMu while waiting for a task run lock, and a
// turn finishing under that run lock asked PublicProgress.quotaBlocked, which
// waited for quotaMu. The bridge stayed deadlocked until restart. Admission
// checks and quota recording must not wait for quotaMu.
func TestQuotaAdmissionDoesNotWaitForQuotaMu(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	scope := e.quotaScopeFor(a, "A")
	until := time.Now().Add(time.Hour).Truncate(time.Second)

	e.quotaMu.Lock() // what quotaTick holds while it walks task runs
	done := make(chan struct{})
	go func() {
		defer close(done)
		e.recordQuotaFor(scope, until, "discord:one")
		if got := e.quotaCoolingFor(e.admissionQuotaScope(a, "discord:one")); !got.Equal(until) {
			t.Errorf("admission under held quotaMu: got %v want %v", got, until)
		}
		if got := e.capacityWait(scope); got <= 0 {
			t.Errorf("capacityWait under held quotaMu: got %v", got)
		}
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		e.quotaMu.Unlock()
		t.Fatal("quota admission/record blocked on quotaMu (lock-order deadlock)")
	}
	e.quotaMu.Unlock()

	// The deferred quotaState update lands once quotaMu is free.
	deadline := time.Now().Add(5 * time.Second)
	for {
		e.quotaMu.Lock()
		gotScope, gotUntil, gotSession := e.quotaState.Scope, e.quotaState.Until, e.quotaState.Session
		e.quotaMu.Unlock()
		if gotScope == scope.key() && gotUntil.Equal(until) && gotSession == "discord:one" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("deferred quota state not applied: scope=%q until=%v session=%q", gotScope, gotUntil, gotSession)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// The quotaBlocked hook runs under a task run lock; quotaTick takes run locks
// while holding quotaMu. Both orders running together must finish.
func TestQuotaBlockedUnderRunLockWithTickHoldingQuotaMu(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	scope := e.quotaScopeFor(a, "A")
	e.recordQuotaFor(scope, time.Now().Add(time.Hour), "discord:one")
	r := &publicRun{}

	r.mu.Lock() // finishRun / relay finish holding the task lock
	tick := make(chan struct{})
	go func() { // quotaTick: quotaMu, then the task lock (quotaWorkItems)
		e.quotaMu.Lock()
		r.mu.Lock()
		r.mu.Unlock()
		e.quotaMu.Unlock()
		close(tick)
	}()
	time.Sleep(20 * time.Millisecond) // let the tick goroutine take quotaMu

	blocked := make(chan bool, 1)
	go func() { blocked <- !e.quotaCoolingFor(e.admissionQuotaScope(e.agent, "discord:one")).IsZero() }()
	select {
	case got := <-blocked:
		if !got {
			t.Fatal("cooling scope reported available")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("quotaBlocked under a run lock waited for quotaMu (lock-order deadlock)")
	}
	r.mu.Unlock()
	select {
	case <-tick:
	case <-time.After(5 * time.Second):
		t.Fatal("tick never finished")
	}
}
