package core

import (
	"context"
	"errors"
	"testing"
	"time"
)

// #190 (remaining half): the retry gate is local pacing. Once the recorded
// deadline has passed, the takeover's own premise is gone, so its lead handoff
// must be unwound before that gate — otherwise a 5-30 minute backoff keeps the
// stand-in primary with a deadline that is already over.
func TestQuotaRetryGateStillRestoresLead(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy190gate", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	now := time.Now().Truncate(time.Second)
	probes := 0
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		probes++
		return true, 0, nil
	}
	e.quotaState = quotaCoolingState{
		Scope:       e.quotaScopeFor(a, modelOf(a)).key(),
		Until:       now.Add(-time.Minute),
		NextProbeAt: now.Add(quotaProbeBackoffBase),
		ProbeRound:  1,
		ProbeStatus: "unknown",
		Lead:        &quotaLeadTakeover{To: "stand-in", At: now.Add(-time.Hour).Format(time.RFC3339)},
	}

	e.quotaTick(now)

	if probes != 0 {
		t.Fatalf("probed before the retry gate opened: %d probe(s)", probes)
	}
	if e.quotaState.Lead != nil {
		t.Fatalf("lead left with the stand-in for the whole retry backoff: %+v", *e.quotaState.Lead)
	}
	sel, ok := readLeadSelectionFull(e.dataDir)
	if !ok || sel.Lead != e.name {
		t.Fatalf("lead selection not restored before the retry gate: ok=%v sel=%+v", ok, sel)
	}
	if !e.quotaState.NextProbeAt.Equal(now.Add(quotaProbeBackoffBase)) {
		t.Fatalf("restoring the lead moved the retry schedule: %v", e.quotaState.NextProbeAt)
	}
}

// A probe that cannot measure the quota leaves the provider deadline expired
// and unproven. That is the same "premise gone" state as the gate case, so the
// handoff must be unwound there too, again without announcing recovery.
func TestQuotaUnknownProbeRestoresLead(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy190unknown", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	now := time.Now().Truncate(time.Second)
	expiry := now.Add(-time.Minute)
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		return false, 0, errors.New("usage panel timed out")
	}
	e.quotaState = quotaCoolingState{
		Scope: e.quotaScopeFor(a, modelOf(a)).key(),
		Until: expiry,
		Lead:  &quotaLeadTakeover{To: "stand-in", At: now.Add(-time.Hour).Format(time.RFC3339)},
	}

	e.quotaTick(now)

	if e.quotaState.Lead != nil {
		t.Fatalf("lead left with the stand-in on an unproven quota: %+v", *e.quotaState.Lead)
	}
	sel, ok := readLeadSelectionFull(e.dataDir)
	if !ok || sel.Lead != e.name {
		t.Fatalf("lead selection not restored on an unproven quota: ok=%v sel=%+v", ok, sel)
	}
	if !e.quotaState.Until.Equal(expiry) || e.quotaState.ProbeStatus != "unknown" {
		t.Fatalf("unproven probe must keep the expired deadline and say unknown: %+v", e.quotaState)
	}
}

// Confirmed exhaustion extends the deadline, so the takeover's premise is back:
// the handoff is kept, not unwound.
func TestQuotaExhaustedProbeKeepsLead(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy190exhausted", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	now := time.Now().Truncate(time.Second)
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		return false, 5 * time.Minute, nil
	}
	lead := &quotaLeadTakeover{To: "stand-in", At: now.Add(-time.Hour).Format(time.RFC3339)}
	e.quotaState = quotaCoolingState{
		Scope: e.quotaScopeFor(a, modelOf(a)).key(),
		Until: now.Add(-time.Minute),
		Lead:  lead,
	}

	e.quotaTick(now)

	if e.quotaState.Lead == nil {
		t.Fatal("confirmed exhaustion unwound the lead handoff it still needs")
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != "stand-in" {
		t.Fatalf("confirmed exhaustion moved the lead selection: ok=%v sel=%+v", ok, sel)
	}
	if !e.quotaState.Until.After(now) || e.quotaState.ProbeStatus != "exhausted" {
		t.Fatalf("confirmed exhaustion must extend the cooldown: %+v", e.quotaState)
	}
}
