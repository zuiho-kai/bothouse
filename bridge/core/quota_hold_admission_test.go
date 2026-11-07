package core

import (
	"context"
	"testing"
	"time"
)

// #269 (#267 验收跟进): the hold in quotaTick read only the exact domain of
// st.Scope while admission (quotaCoolingForAt) also reads the provider guard an
// unresolved identity falls back to. An identity lookup that fails leaves this
// role's own domain empty; a peer with a known identity then pushes the same
// pool past this role's deadline, which raises only the guard. Admission said
// "cooling until T2" and quotaTick handed the lead back anyway.
//
// Before the fix this test failed on the lead assertions below: the hold saw an
// empty exact domain and unwound the takeover.
func TestQuotaHoldFollowsUnknownAccountGuard(t *testing.T) {
	a := &quotaDomainTestAgent{stubModelModeAgent: stubModelModeAgent{model: "m"}, account: "unknown"}
	e := NewEngine("fy269unknownguard", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	t.Cleanup(e.waitQuotaUpdates)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	now := time.Now().Truncate(time.Second)
	at := now.Add(-time.Hour).Format(time.RFC3339)
	if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}

	scope := e.quotaScopeFor(a, modelOf(a))
	if scope.Account != "unknown" {
		t.Fatalf("fixture: the scope must have an unresolved account, got %q", scope.Account)
	}
	// A peer with a known identity pushed the pool to T2; only the provider
	// guard moved, this role's own domain stayed empty.
	poolUntil := now.Add(time.Hour)
	quotaDomainsMu.Lock()
	e.saveDomainLocked(quotaScope{Provider: scope.Provider}.key(), poolUntil)
	own := e.domainUntilLocked(scope.key())
	quotaDomainsMu.Unlock()
	if !own.IsZero() {
		t.Fatalf("fixture: the unresolved scope must have no exact domain, got %v", own)
	}

	probes := 0
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		probes++
		return true, 0, nil
	}
	e.quotaState = quotaCoolingState{
		Scope:       scope.key(),
		Until:       now.Add(-time.Minute), // T1, this role's own deadline: passed
		NextProbeAt: now.Add(quotaProbeBackoffBase),
		ProbeRound:  1,
		ProbeStatus: "unknown",
		Lead:        &quotaLeadTakeover{To: "stand-in", At: at},
	}

	if admission := e.quotaCooling(); !admission.Equal(poolUntil) {
		t.Fatalf("fixture: admission must report the guard's deadline %v, got %v", poolUntil, admission)
	}

	e.quotaTick(now)

	if probes != 0 {
		t.Fatalf("the retry gate opened: %d probe(s)", probes)
	}
	if e.quotaState.Lead == nil {
		t.Fatal("admission still cools to the guard's deadline, but the lead was handed back")
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != "stand-in" {
		t.Fatalf("shared lead moved while the pool still cools: ok=%v sel=%+v", ok, sel)
	}
	if !e.quotaState.Until.Equal(poolUntil) {
		t.Fatalf("local deadline not refreshed from the guard: %v want %v", e.quotaState.Until, poolUntil)
	}
	if !e.quotaState.NextProbeAt.Equal(now.Add(quotaProbeBackoffBase)) {
		t.Fatalf("the retry schedule was rewritten: %v", e.quotaState.NextProbeAt)
	}
}

// #269: a state recorded before scopes existed (st.Scope == "", the legacy
// role-level deadline only) still has to restore the lead on both expiry paths
// once everything has expired. This pins the old "no scope means no pool" answer
// that used to be a bare first-line return: making the hold answer true
// unconditionally turns both sub-cases red (mutation run in the report).
func TestQuotaHoldWithoutScopeStillRestoresLead(t *testing.T) {
	cases := []struct {
		name string
		// no probe capability and no probe hook: the no-reporter branch is taken.
		noReporter bool
	}{
		{name: "retry gate branch"},
		{name: "no reporter branch", noReporter: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := &stubModelModeAgent{model: "m"}
			e := NewEngine("fy269noscope", a, nil, "", LangEnglish)
			e.dataDir = t.TempDir()
			t.Cleanup(e.cancel)
			t.Cleanup(e.waitQuotaUpdates)
			e.SetRelayManager(NewRelayManager(e.dataDir))

			now := time.Now().Truncate(time.Second)
			at := now.Add(-time.Hour).Format(time.RFC3339)
			if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", now.Add(-time.Hour)); err != nil {
				t.Fatalf("seed lead selection: %v", err)
			}
			if !tc.noReporter {
				e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
					t.Fatal("the retry gate should still defer the probe")
					return true, 0, nil
				}
			}
			e.quotaState = quotaCoolingState{
				Until:       now.Add(-time.Minute),
				NextProbeAt: now.Add(quotaProbeBackoffBase),
				ProbeRound:  1,
				ProbeStatus: "unknown",
				Lead:        &quotaLeadTakeover{To: "stand-in", At: at},
			}

			e.quotaTick(now)

			if e.quotaState.Lead != nil {
				t.Fatalf("nothing is cooling, but the takeover was kept: %+v", *e.quotaState.Lead)
			}
			if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != e.name {
				t.Fatalf("lead selection not restored: ok=%v sel=%+v", ok, sel)
			}
		})
	}
}

// #269: the third record admission reads is the legacy role-level deadline.
// While it still cools, the hold has to keep the takeover even with no scope
// recorded; a scope a positive probe verified is exempt exactly as admission
// exempts it, so that one still unwinds.
func TestQuotaHoldWithoutScopeFollowsLegacyDeadline(t *testing.T) {
	run := func(t *testing.T, verified bool) *Engine {
		t.Helper()
		a := &stubModelModeAgent{model: "m"}
		e := NewEngine("fy269legacy", a, nil, "", LangEnglish)
		e.dataDir = t.TempDir()
		t.Cleanup(e.cancel)
		t.Cleanup(e.waitQuotaUpdates)
		e.SetRelayManager(NewRelayManager(e.dataDir))

		now := time.Now().Truncate(time.Second)
		at := now.Add(-time.Hour).Format(time.RFC3339)
		if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", now.Add(-time.Hour)); err != nil {
			t.Fatalf("seed lead selection: %v", err)
		}
		legacyUntil := now.Add(time.Hour)
		e.quotaUntil = legacyUntil
		e.quotaState = quotaCoolingState{
			Until:       now.Add(-time.Minute),
			NextProbeAt: now.Add(quotaProbeBackoffBase),
			ProbeRound:  1,
			ProbeStatus: "unknown",
			Lead:        &quotaLeadTakeover{To: "stand-in", At: at},
		}
		if verified {
			scope := e.quotaScopeFor(a, modelOf(a))
			e.quotaState.Verified = map[string]bool{scope.key(): true}
		}
		e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
			t.Fatal("the retry gate should still defer the probe")
			return true, 0, nil
		}
		e.quotaTick(now)
		return e
	}

	t.Run("legacy deadline still cooling", func(t *testing.T) {
		e := run(t, false)
		if e.quotaState.Lead == nil {
			t.Fatal("the legacy deadline admission reads still cools, but the lead was handed back")
		}
		if !e.quotaState.Until.After(time.Now()) {
			t.Fatalf("local deadline not refreshed from the legacy record: %v", e.quotaState.Until)
		}
	})

	t.Run("verified scope is exempt", func(t *testing.T) {
		e := run(t, true)
		if e.quotaState.Lead != nil {
			t.Fatalf("a verified scope is exempt from the legacy record, but the takeover was kept: %+v", *e.quotaState.Lead)
		}
		if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != e.name {
			t.Fatalf("lead selection not restored for an exempt scope: ok=%v sel=%+v", ok, sel)
		}
	})
}
