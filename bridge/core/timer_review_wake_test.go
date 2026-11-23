package core

import (
	"strings"
	"testing"
	"time"
)

// #1915: a workspace handback waiting for the lead's acceptance is replayed after a restart that
// missed it by more than the grace period, instead of being marked stale with a 「错过了」 notice.
func TestTimerStart_ReplaysStaleHandbackWake(t *testing.T) {
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-12 * time.Minute)
	wake := &TimerJob{ID: "wake1910", Project: "p", SessionKey: "discord:lead", ScheduledAt: old, CreatedAt: old,
		Prompt: "【待主角色验收，用户未见】", Description: "工作区汇报待验收 #1910", ReportID: "rk", ReplyBoard: 1910}
	plain := &TimerJob{ID: "plain", Project: "p", SessionKey: "discord:lead", ScheduledAt: old, CreatedAt: old,
		Prompt: "提醒我喝水", Description: "喝水"}
	for _, j := range []*TimerJob{wake, plain} {
		if _, err := store.add(j, false); err != nil {
			t.Fatal(err)
		}
	}
	ts := NewTimerScheduler(store)
	if err := ts.Start(); err != nil {
		t.Fatal(err)
	}
	ts.Stop()
	if got := store.Get("plain"); !got.Fired || got.LastError == "" {
		t.Fatalf("an ordinary stale timer stays skipped: %+v", got)
	}
	// No engine is registered here, so the replayed run itself fails; what matters is that it ran.
	if got := store.Get("wake1910"); strings.Contains(got.LastError, "stale") {
		t.Fatalf("handback wake must be replayed, not marked stale: %q", got.LastError)
	}
}

// #1915: acceptance wakes and the board's guard timers are deliveries, not self-polling; a third
// one in the same lead session inside 10 minutes is not refused.
func TestCheckAntiSpinTimer_HandbackWakesAndGuardsPass(t *testing.T) {
	now := time.Now()
	sk := "discord:lead"
	others := []*TimerJob{
		{ID: "w1", SessionKey: sk, ScheduledAt: now.Add(-4 * time.Minute), Prompt: "验收 #1910", ReportID: "a"},
		{ID: "w2", SessionKey: sk, ScheduledAt: now.Add(-2 * time.Minute), Prompt: "验收 #1911", ReportID: "b"},
		{ID: "g1", SessionKey: sk, ScheduledAt: now.Add(28 * time.Minute), Prompt: "兜底 #1910", Guard: true},
		{ID: "g2", SessionKey: sk, ScheduledAt: now.Add(29 * time.Minute), Prompt: "兜底 #1911", Guard: true},
	}
	if err := CheckAntiSpinTimer(&TimerJob{ID: "g3", SessionKey: sk, ScheduledAt: now.Add(30 * time.Minute), Prompt: "兜底 #1912", Guard: true}, others); err != nil {
		t.Fatalf("third guard must pass: %v", err)
	}
	if err := CheckAntiSpinTimer(&TimerJob{ID: "w3", SessionKey: sk, ScheduledAt: now, Prompt: "验收 #1912", ReportID: "c"}, others); err != nil {
		t.Fatalf("third acceptance wake must pass: %v", err)
	}
	// Self-set prompt timers are still counted.
	self := []*TimerJob{
		{ID: "s1", SessionKey: sk, ScheduledAt: now.Add(1 * time.Minute), Prompt: "看一眼"},
		{ID: "s2", SessionKey: sk, ScheduledAt: now.Add(2 * time.Minute), Prompt: "再看一眼"},
	}
	if err := CheckAntiSpinTimer(&TimerJob{ID: "s3", SessionKey: sk, ScheduledAt: now.Add(3 * time.Minute), Prompt: "又看一眼"}, self); err == nil {
		t.Fatal("self-polling prompt timers must still be refused")
	}
}
