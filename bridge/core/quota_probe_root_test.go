package core

import (
	"context"
	"errors"
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
