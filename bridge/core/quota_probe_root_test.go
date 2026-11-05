package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

func TestQuotaProbeErrorDoesNotInventProviderReset(t *testing.T) {
	e := setupQuotaTestEngine(t)
	now := time.Now()
	expiry := now.Add(-time.Minute)
	e.quotaState.Until = expiry
	e.quotaUntil = expiry
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		return false, 0, errors.New("usage panel timed out")
	}
	e.quotaTick(now)
	if !e.quotaState.Until.Equal(expiry) {
		t.Fatalf("probe failure invented provider reset: got %v want %v", e.quotaState.Until, expiry)
	}
}

func TestQuotaProbeUnknownBackoffPersistsAndRecovers(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	e.SetRelayManager(NewRelayManager(e.dataDir))
	now := time.Now()
	expiry := now.Add(-time.Minute)
	scope := e.quotaScopeFor(a, "A")
	e.quotaState = quotaCoolingState{Scope: scope.key(), Until: expiry}
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), expiry)
	quotaDomainsMu.Unlock()
	calls := 0
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		calls++
		return false, 0, errors.New("claudecode: missing usage percentage in Current week block")
	}
	e.quotaTick(now)
	if !e.quotaState.Until.Equal(expiry) || e.quotaState.ProbeStatus != "unknown" {
		t.Fatalf("unknown probe changed provider deadline/status: %+v", e.quotaState)
	}
	quotaDomainsMu.Lock()
	got := e.domainUntilLocked(scope.key())
	quotaDomainsMu.Unlock()
	if !got.Equal(expiry) {
		t.Fatalf("unknown probe changed shared domain: %v", got)
	}
	data, err := os.ReadFile(e.quotaPath())
	if err != nil {
		t.Fatal(err)
	}
	var saved quotaCoolingState
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if !saved.NextProbeAt.Equal(now.Add(quotaProbeBackoffBase)) || saved.ProbeStatus != "unknown" {
		t.Fatalf("retry state not persisted separately: %+v", saved)
	}
	// Reload through the production startup path; an expired provider deadline
	// must not drop a still-pending local probe retry.
	e.loadQuotaCooling()
	e.quotaTick(now.Add(time.Second))
	if calls != 1 {
		t.Fatalf("retried before persisted backoff: calls=%d", calls)
	}
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) { return true, 0, nil }
	e.quotaTick(saved.NextProbeAt.Add(time.Second))
	if !e.quotaState.Until.IsZero() || !e.quotaState.NextProbeAt.IsZero() || e.quotaState.ProbeStatus != "available" {
		t.Fatalf("positive measurement did not recover: %+v", e.quotaState)
	}
}

func TestQuotaProbeUnknownCannotBypassConfirmedExhaustion(t *testing.T) {
	e := setupQuotaTestEngine(t)
	now := time.Now()
	until := now.Add(time.Hour)
	e.quotaState.Until, e.quotaUntil = until, until
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		t.Fatal("confirmed unexpired quota was probed")
		return false, 0, errors.New("unavailable")
	}
	e.quotaTick(now)
	if !e.quotaCooling().Equal(until) {
		t.Fatal("unexpired exhaustion bypassed")
	}
}

func TestQuotaProbeResetIsNotRoundedUpToRetryBackoff(t *testing.T) {
	e := setupQuotaTestEngine(t)
	now := time.Now()
	e.quotaState.Until = now.Add(-time.Minute)
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) { return false, time.Minute, nil }
	e.quotaTick(now)
	if !e.quotaState.Until.Equal(now.Add(time.Minute)) || e.quotaState.ProbeStatus != "exhausted" {
		t.Fatalf("provider reset rounded up: %+v", e.quotaState)
	}
}

func TestQuotaProbeUnknownCannotEraseConcurrentExhaustion(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	e.SetRelayManager(NewRelayManager(e.dataDir))
	peer := NewEngine("peer", a, nil, "", LangEnglish)
	peer.dataDir = e.dataDir
	t.Cleanup(peer.cancel)
	scope := e.quotaScopeFor(a, "A")
	expiry := time.Now().Add(-time.Minute)
	e.quotaState = quotaCoolingState{Scope: scope.key(), Until: expiry}
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), expiry)
	quotaDomainsMu.Unlock()
	newer := time.Now().Add(time.Hour)
	e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
		peer.recordQuotaFor(scope, newer, "")
		return false, 0, errors.New("usage unavailable")
	}
	e.quotaTick(time.Now())
	if !e.quotaCooling().Equal(newer) {
		t.Fatal("unknown erased new exhaustion")
	}
}
