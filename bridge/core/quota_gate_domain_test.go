package core

import (
	"context"
	"testing"
	"time"
)

// #267 (#256 复核跟进): the retry-gate unwind only compared the local deadline.
// Another role can extend the same pool's shared domain into the future right
// after this one's local deadline passed; unwinding then hands the lead back to
// a role that is still exhausted, and the local deadline is never refreshed.
// While the domain still cools, the takeover stays and st.Until follows it.
func TestQuotaRetryGateKeepsLeadWhileDomainStillCooling(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy267gatehold", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	now := time.Now().Truncate(time.Second)
	at := now.Add(-time.Hour).Format(time.RFC3339)
	if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	scope := e.quotaScopeFor(a, modelOf(a))
	domainUntil := now.Add(time.Hour) // another role just extended this pool
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), domainUntil)
	quotaDomainsMu.Unlock()

	probes := 0
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		probes++
		return true, 0, nil
	}
	e.quotaState = quotaCoolingState{
		Scope:       scope.key(),
		Until:       now.Add(-time.Minute),
		NextProbeAt: now.Add(2 * quotaProbeBackoffBase),
		ProbeRound:  1,
		ProbeStatus: "unknown",
		Lead:        &quotaLeadTakeover{To: "stand-in", At: at},
	}

	e.quotaTick(now)

	if probes != 0 {
		t.Fatalf("probed before the retry gate opened: %d probe(s)", probes)
	}
	if e.quotaState.Lead == nil {
		t.Fatal("domain still cooling, but the lead was handed back to the stand-in's owner")
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != "stand-in" {
		t.Fatalf("domain still cooling, but the shared lead moved: ok=%v sel=%+v", ok, sel)
	}
	if !e.quotaState.Until.Equal(domainUntil) {
		t.Fatalf("local deadline not refreshed from the shared domain: %v want %v", e.quotaState.Until, domainUntil)
	}
	if !e.quotaState.NextProbeAt.Equal(now.Add(2 * quotaProbeBackoffBase)) {
		t.Fatalf("the retry schedule was rewritten: %v", e.quotaState.NextProbeAt)
	}
}

// The hold above must not block the normal restore: with the shared domain also
// expired, the gate branch still unwinds.
func TestQuotaRetryGateRestoresLeadWhenDomainAlsoExpired(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy267gateexp", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	now := time.Now().Truncate(time.Second)
	at := now.Add(-time.Hour).Format(time.RFC3339)
	if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	scope := e.quotaScopeFor(a, modelOf(a))
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), now.Add(-time.Hour))
	quotaDomainsMu.Unlock()

	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		t.Fatal("the retry gate should still defer the probe")
		return true, 0, nil
	}
	e.quotaState = quotaCoolingState{
		Scope:       scope.key(),
		Until:       now.Add(-time.Minute),
		NextProbeAt: now.Add(2 * quotaProbeBackoffBase),
		ProbeRound:  1,
		ProbeStatus: "unknown",
		Lead:        &quotaLeadTakeover{To: "stand-in", At: at},
	}

	e.quotaTick(now)

	if e.quotaState.Lead != nil {
		t.Fatalf("domain expired too, but the takeover was kept: %+v", *e.quotaState.Lead)
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != e.name {
		t.Fatalf("lead selection not restored: ok=%v sel=%+v", ok, sel)
	}
}

// The no-reporter branch has the same defect and the same fix.
func TestQuotaNoReporterKeepsLeadWhileDomainStillCooling(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy267noreporterhold", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	now := time.Now().Truncate(time.Second)
	at := now.Add(-time.Hour).Format(time.RFC3339)
	if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	scope := e.quotaScopeFor(a, modelOf(a))
	domainUntil := now.Add(time.Hour)
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), domainUntil)
	quotaDomainsMu.Unlock()

	e.quotaState = quotaCoolingState{
		Scope: scope.key(),
		Until: now.Add(-time.Minute),
		Lead:  &quotaLeadTakeover{To: "stand-in", At: at},
	}

	e.quotaTick(now)

	if e.quotaState.Lead == nil {
		t.Fatal("no-reporter branch: domain still cooling, but the lead was handed back")
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != "stand-in" {
		t.Fatalf("no-reporter branch: shared lead moved while the pool still cools: ok=%v sel=%+v", ok, sel)
	}
	if !e.quotaState.Until.Equal(domainUntil) {
		t.Fatalf("no-reporter branch: local deadline not refreshed from the domain: %v want %v", e.quotaState.Until, domainUntil)
	}
}

// And the no-reporter branch still unwinds when the domain went with it.
func TestQuotaNoReporterRestoresLeadWhenDomainAlsoExpired(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy267noreporterexp", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	now := time.Now().Truncate(time.Second)
	at := now.Add(-time.Hour).Format(time.RFC3339)
	if err := writeLeadSelectionFile(e.dataDir, "stand-in", "Stand-in", now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	scope := e.quotaScopeFor(a, modelOf(a))
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), now.Add(-time.Hour))
	quotaDomainsMu.Unlock()

	e.quotaState = quotaCoolingState{
		Scope: scope.key(),
		Until: now.Add(-time.Minute),
		Lead:  &quotaLeadTakeover{To: "stand-in", At: at},
	}

	e.quotaTick(now)

	if e.quotaState.Lead != nil {
		t.Fatalf("no-reporter branch: domain expired too, but the takeover was kept: %+v", *e.quotaState.Lead)
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != e.name {
		t.Fatalf("no-reporter branch: lead selection not restored: ok=%v sel=%+v", ok, sel)
	}
}
