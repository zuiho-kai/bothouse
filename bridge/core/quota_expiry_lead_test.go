package core

import (
	"testing"
	"time"
)

// Non-author review takeaway on #824: when a recorded deadline passes on a
// backend with no usage reporter, the early return must not strand the lead
// takeover it caused. The selection this engine wrote is restored, and the
// quota itself is still not announced as recovered.
func TestQuotaExpiryWithoutUsageReporterRestoresLead(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy59expiry", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	at := time.Now().Add(-time.Hour).Format(time.RFC3339)
	if err := writeLeadSelectionFile(e.dataDir, "other", "Other", time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	scope := e.quotaScopeFor(a, modelOf(a))
	e.quotaState = quotaCoolingState{
		Scope: scope.key(),
		Until: time.Now().Add(-time.Second),
		Lead:  &quotaLeadTakeover{To: "other", At: at},
	}

	e.quotaTick(time.Now())

	if got := e.quotaCooling(); !got.IsZero() {
		t.Fatalf("expired deadline still reported as cooling until %v", got)
	}
	if e.quotaState.Lead != nil {
		t.Fatalf("stale lead takeover left after deadline: %+v", *e.quotaState.Lead)
	}
	sel, ok := readLeadSelectionFull(e.dataDir)
	if !ok || sel.Lead != e.name {
		t.Fatalf("lead selection not restored: ok=%v sel=%+v", ok, sel)
	}
}

// A takeover recorded here whose selection has since been replaced by a later
// choice must be dropped without rewriting that newer choice.
func TestQuotaExpiryWithoutUsageReporterKeepsLaterLeadChoice(t *testing.T) {
	a := &stubModelModeAgent{model: "m"}
	e := NewEngine("fy59expiry2", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	e.SetRelayManager(NewRelayManager(e.dataDir))

	if err := writeLeadSelectionFile(e.dataDir, "human-picked", "Human Pick", time.Now()); err != nil {
		t.Fatalf("seed lead selection: %v", err)
	}
	scope := e.quotaScopeFor(a, modelOf(a))
	e.quotaState = quotaCoolingState{
		Scope: scope.key(),
		Until: time.Now().Add(-time.Second),
		Lead:  &quotaLeadTakeover{To: "other", At: time.Now().Add(-time.Hour).Format(time.RFC3339)},
	}

	e.quotaTick(time.Now())

	if e.quotaState.Lead != nil {
		t.Fatalf("stale lead takeover left after deadline: %+v", *e.quotaState.Lead)
	}
	if sel, ok := readLeadSelectionFull(e.dataDir); !ok || sel.Lead != "human-picked" {
		t.Fatalf("later lead choice overwritten: ok=%v sel=%+v", ok, sel)
	}
}
