package core

import (
	"context"
	"testing"
	"time"
)

// #190: an expired cooldown is unwound (or a probe is run) by the same tick, but
// the local retry gate stood in front of that path. A persisted retry time this
// code cannot have written (a corrupt/legacy record, or a backwards clock step)
// therefore kept the takeover in place forever; the lead was never restored.
// Seen on the board: the lead was still the stand-in after the deadline passed.
func TestQuotaUnreachableNextProbeDoesNotStrandLeadTakeover(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy190gate", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	now := time.Now()
	at := now.Add(-time.Hour).Format(time.RFC3339)
	if err := writeLeadSelectionFile(e.dataDir, "other", "Other", now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	probes := 0
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		probes++
		return true, 0, nil
	}
	scope := e.quotaScopeFor(a, modelOf(a))
	e.quotaState = quotaCoolingState{
		Scope:       scope.key(),
		Until:       now.Add(-time.Minute),
		NextProbeAt: now.Add(30 * 24 * time.Hour), // far beyond any wait this code writes
		Lead:        &quotaLeadTakeover{To: "other", At: at},
	}

	e.quotaTick(now)

	if probes != 1 {
		t.Fatalf("unreachable retry time skipped the probe: probes=%d", probes)
	}
	if e.quotaState.Lead != nil {
		t.Fatalf("stale lead takeover left in place: %+v", *e.quotaState.Lead)
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != e.name {
		t.Fatalf("lead selection not restored: ok=%v sel=%+v", ok, sel)
	}
}

// The protection above must not weaken normal retry pacing: a retry time this
// code did write still defers the probe. It no longer defers the unwind though:
// the deadline has passed, so the takeover’s premise is gone and the stand-in
// goes back now the same tick, while NextProbeAt is left untouched so the pace
// of probes is unchanged (see TestQuotaRetryGateStillRestoresLead).
func TestQuotaReachableNextProbeStillDefersProbe(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy190gate2", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	now := time.Now()
	at := now.Add(-time.Hour).Format(time.RFC3339)
	if err := writeLeadSelectionFile(e.dataDir, "other", "Other", now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	probes := 0
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		probes++
		return true, 0, nil
	}
	scope := e.quotaScopeFor(a, modelOf(a))
	e.quotaState = quotaCoolingState{
		Scope:       scope.key(),
		Until:       now.Add(-time.Minute),
		NextProbeAt: now.Add(quotaProbeBackoffMax), // the longest wait the backoff writes
		Lead:        &quotaLeadTakeover{To: "other", At: at},
	}

	e.quotaTick(now)

	if probes != 0 {
		t.Fatalf("backoff not honoured: probes=%d", probes)
	}
	if !e.quotaState.NextProbeAt.After(now) {
		t.Fatalf("pending retry state disturbed: %+v", e.quotaState)
	}
	if e.quotaState.Lead != nil {
		t.Fatalf("stand-in kept past the deadline it was chosen for: %+v", *e.quotaState.Lead)
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != e.name {
		t.Fatalf("lead selection not restored: ok=%v sel=%+v", ok, sel)
	}
}
