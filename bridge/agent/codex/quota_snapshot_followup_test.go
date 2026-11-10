package codex

import (
	"testing"
	"time"
)

func TestMergeUsage_SparseUpdatesPreserveWindowObservation(t *testing.T) {
	s := &appServerSession{}
	full := mapAppServerRateLimits(decodeRateLimits(t, plusRateLimits))
	old := time.Now().Add(-time.Hour)
	full.ObservedAt = old
	for i := range full.Buckets[0].Windows {
		full.Buckets[0].Windows[i].ObservedAt = old
	}
	s.storeUsage(full)
	update := mapAppServerRateLimits(decodeRateLimits(t, `{"rateLimits":{"limitId":"codex","primary":{"usedPercent":12,"windowDurationMins":300}}}`))
	s.mergeUsage(update)
	windows := s.CachedUsage().Buckets[0].Windows
	if !windows[0].ObservedAt.Equal(update.ObservedAt) {
		t.Errorf("new primary lost source time: %v", windows[0].ObservedAt)
	}
	if !windows[1].ObservedAt.Equal(old) {
		t.Errorf("retained weekly was renewed: %v", windows[1].ObservedAt)
	}
	before := s.CachedUsage()
	s.mergeUsage(mapAppServerRateLimits(decodeRateLimits(t, relayRateLimits)))
	if !s.CachedUsage().ObservedAt.Equal(before.ObservedAt) {
		t.Error("null update renewed the quota snapshot")
	}
}
