package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

type testUsageReporterAgent struct {
	stubReplyFooterAgent
	report *UsageReport
	err    error
	calls  int
}

func (a *testUsageReporterAgent) GetUsage(ctx context.Context) (*UsageReport, error) {
	a.calls++
	return a.report, a.err
}

func setupQuotaTestEngine(t *testing.T) *Engine {
	t.Helper()
	e, _, _ := exitFixture(t, nil)
	rm := NewRelayManager(e.dataDir)
	e.SetRelayManager(rm)
	rm.RegisterEngine(e.name, e)
	return e
}

func TestQuotaAutoProbe(t *testing.T) {
	t.Run("ProbeSuccessRestoresCoolingAndLead", func(t *testing.T) {
		e := setupQuotaTestEngine(t)
		now := time.Now()
		expiry := now.Add(-time.Second) // already reached expiry

		probeCalls := 0
		e.quotaProbeFn = func(ctx context.Context) (bool, time.Duration, error) {
			probeCalls++
			return true, 0, nil
		}

		e.quotaState.Until = expiry
		e.quotaUntil = expiry
		e.saveQuotaLocked()

		// Run tick
		e.quotaTick(now)

		if probeCalls != 1 {
			t.Fatalf("expected 1 probe call, got %d", probeCalls)
		}
		if !e.quotaCooling().IsZero() {
			t.Fatalf("expected quota cooling cleared after successful probe, got %v", e.quotaCooling())
		}
		if !e.quotaState.Until.IsZero() {
			t.Fatalf("expected quotaState.Until zeroed, got %v", e.quotaState.Until)
		}
		if e.quotaState.ProbeRound != 0 {
			t.Fatalf("expected ProbeRound 0, got %d", e.quotaState.ProbeRound)
		}

		// Verify state was saved to disk
		b, err := os.ReadFile(e.quotaPath())
		if err != nil {
			t.Fatal(err)
		}
		var saved quotaCoolingState
		if err := json.Unmarshal(b, &saved); err != nil {
			t.Fatal(err)
		}
		if !saved.Until.IsZero() {
			t.Fatalf("expected persisted Until to be zero, got %v", saved.Until)
		}
	})

	t.Run("ProbeFailureBacksOffAndPreservesCooling", func(t *testing.T) {
		e := setupQuotaTestEngine(t)
		now := time.Now()
		expiry := now.Add(-time.Second)

		probeCalls := 0
		e.quotaProbeFn = func(ctx context.Context) (bool, time.Duration, error) {
			probeCalls++
			return false, 0, errors.New("429 Too Many Requests")
		}

		e.quotaState.Until = expiry
		e.quotaUntil = expiry
		e.saveQuotaLocked()

		// Tick 1
		e.quotaTick(now)

		if probeCalls != 1 {
			t.Fatalf("expected 1 probe call, got %d", probeCalls)
		}
		if e.quotaCooling().IsZero() {
			t.Fatal("expected quota cooling to remain active after failed probe")
		}
		if e.quotaState.ProbeRound != 1 {
			t.Fatalf("expected ProbeRound 1, got %d", e.quotaState.ProbeRound)
		}
		expectedUntil := now.Add(quotaProbeBackoffBase)
		if e.quotaState.Until.Sub(expectedUntil).Abs() > time.Second {
			t.Fatalf("expected Until ~%v, got %v", expectedUntil, e.quotaState.Until)
		}

		// Verify persisted state holds extended Until and probe round
		b, err := os.ReadFile(e.quotaPath())
		if err != nil {
			t.Fatal(err)
		}
		var saved quotaCoolingState
		if err := json.Unmarshal(b, &saved); err != nil {
			t.Fatal(err)
		}
		if saved.ProbeRound != 1 {
			t.Fatalf("expected persisted ProbeRound 1, got %d", saved.ProbeRound)
		}
		if saved.Until.Before(now) {
			t.Fatalf("expected persisted Until in the future, got %v", saved.Until)
		}

		// Tick 2: when next expiry arrives, backoff doubles
		nextNow := e.quotaState.Until.Add(time.Second)
		e.quotaTick(nextNow)
		if e.quotaState.ProbeRound != 2 {
			t.Fatalf("expected ProbeRound 2, got %d", e.quotaState.ProbeRound)
		}
		expectedUntil2 := nextNow.Add(quotaProbeBackoffBase * 2)
		if e.quotaState.Until.Sub(expectedUntil2).Abs() > time.Second {
			t.Fatalf("expected Until ~%v, got %v", expectedUntil2, e.quotaState.Until)
		}
	})

	t.Run("UsageReporterProbeRestoresWhenAvailable", func(t *testing.T) {
		e := setupQuotaTestEngine(t)
		now := time.Now()
		expiry := now.Add(-time.Second)

		agent := &testUsageReporterAgent{
			report: &UsageReport{
				Buckets: []UsageBucket{{
					LimitReached: false,
					Windows: []UsageWindow{{
						UsedPercent: 10,
					}},
				}},
			},
		}
		e.agent = agent

		e.quotaState.Until = expiry
		e.quotaUntil = expiry
		e.saveQuotaLocked()

		e.quotaTick(now)

		if agent.calls != 1 {
			t.Fatalf("expected 1 GetUsage call, got %d", agent.calls)
		}
		if !e.quotaCooling().IsZero() {
			t.Fatalf("expected cooling cleared, got %v", e.quotaCooling())
		}
	})

	t.Run("UsageReporterProbeStillLimitReachedExtendsCooldown", func(t *testing.T) {
		e := setupQuotaTestEngine(t)
		now := time.Now()
		expiry := now.Add(-time.Second)

		agent := &testUsageReporterAgent{
			report: &UsageReport{
				Buckets: []UsageBucket{{
					LimitReached: true,
					Windows: []UsageWindow{{
						UsedPercent: 100,
					}},
				}},
			},
		}
		e.agent = agent

		e.quotaState.Until = expiry
		e.quotaUntil = expiry
		e.saveQuotaLocked()

		e.quotaTick(now)

		if agent.calls != 1 {
			t.Fatalf("expected 1 GetUsage call, got %d", agent.calls)
		}
		if e.quotaCooling().IsZero() {
			t.Fatal("expected cooling to remain active when UsageReport limit reached")
		}
		if e.quotaState.ProbeRound != 1 {
			t.Fatalf("expected ProbeRound 1, got %d", e.quotaState.ProbeRound)
		}
	})
}
