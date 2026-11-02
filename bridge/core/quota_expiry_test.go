package core

import (
	"testing"
	"time"
)

// Reviewer repro: a backend with no usage reporter hits quota with a known
// reset; after the reset passes the role must become usable again.
func TestReview59NoReporterRecoversAfterReset(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("review59", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))
	scope := e.quotaScopeFor(a, modelOf(a))
	reset := time.Now().Add(-time.Second)
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), reset)
	quotaDomainsMu.Unlock()
	e.quotaState = quotaCoolingState{Scope: scope.key(), Until: reset}
	for i := 0; i < 3; i++ {
		e.quotaTick(time.Now())
		t.Logf("tick %d: cooling=%v round=%d", i, e.quotaCooling(), e.quotaState.ProbeRound)
		e.quotaState.Until = time.Now().Add(-time.Second) // pretend backoff elapsed
		quotaDomainsMu.Lock()
		e.saveDomainLocked(scope.key(), e.quotaState.Until)
		quotaDomainsMu.Unlock()
	}
	e.quotaTick(time.Now())
	if got := e.quotaCooling(); !got.IsZero() {
		t.Fatalf("provider reset passed but role still cooling until %v (round %d)", got, e.quotaState.ProbeRound)
	}
}
