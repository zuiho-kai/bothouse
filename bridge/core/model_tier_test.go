package core

import (
	"testing"
	"time"
)

func newTestTiers() *modelTiers {
	e := &Engine{}
	e.SetModelTiers("sonnet", "opus", "", "medium", 10)
	return e.tiers
}

func TestModelTierPick(t *testing.T) {
	tr := newTestTiers()
	now := time.Now()
	if got := tr.pick("k", "chat", now); got != tierChat {
		t.Fatalf("chat with no prior task = %q, want chat", got)
	}
	if got := tr.pick("k", "task", now); got != tierTask {
		t.Fatalf("task = %q, want task", got)
	}
	// Small talk right after a task stays on the task model (no restart ping-pong).
	if got := tr.pick("k", "chat", now.Add(5*time.Minute)); got != tierTask {
		t.Fatalf("chat 5m after task = %q, want task (sticky)", got)
	}
	// After the sticky window it drops back to chat.
	if got := tr.pick("k", "chat", now.Add(11*time.Minute)); got != tierChat {
		t.Fatalf("chat 11m after task = %q, want chat", got)
	}
	// No tag from the gate: leave the model alone.
	if got := tr.pick("k", "", now); got != "" {
		t.Fatalf("empty tag = %q, want no switch", got)
	}
	// Sessions are tracked separately.
	tr.pick("a", "task", now)
	if got := tr.pick("b", "chat", now); got != tierChat {
		t.Fatalf("other session = %q, want chat", got)
	}
}

func TestModelTierTarget(t *testing.T) {
	tr := newTestTiers()
	if m, eff := tr.target(tierChat); m != "sonnet" || eff != "" {
		t.Fatalf("chat target = %q/%q", m, eff)
	}
	if m, eff := tr.target(tierTask); m != "opus" || eff != "medium" {
		t.Fatalf("task target = %q/%q", m, eff)
	}
}

func TestSetModelTiersNeedsBothModels(t *testing.T) {
	e := &Engine{}
	e.SetModelTiers("sonnet", "", "", "", 0)
	if e.tiers != nil {
		t.Fatal("tiers enabled with only a chat model")
	}
	e.SetModelTiers("sonnet", "opus", "", "", 0)
	if e.tiers == nil || e.tiers.sticky != defaultTierSticky {
		t.Fatalf("default sticky not applied: %+v", e.tiers)
	}
}
