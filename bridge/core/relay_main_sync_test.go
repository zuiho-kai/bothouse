package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestTaskRelayFailureAfterLeadReleaseWakesLead(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	store := settledTimerStore(t)
	rm.engines["source"].timerScheduler = NewTimerScheduler(store)
	session.onSend = func(string) {
		p.finish(run, "cancelled")
		session.events <- Event{Type: EventError, Content: "provider rejected request"}
	}
	if _, err := rm.Send(context.Background(), taskRelayRequest(id)); err == nil {
		t.Fatal("expected failed relay")
	}
	jobs := store.List()
	if len(jobs) != 1 || jobs[0].SessionKey != "discord:room:user" || !strings.Contains(jobs[0].Prompt, "派工失败") || !strings.Contains(jobs[0].Prompt, "这一轮就自己接着做") {
		t.Fatalf("released lead did not receive actionable failure: %+v", jobs)
	}
	if _, err := rm.Send(context.Background(), taskRelayRequest(id)); err == nil {
		t.Fatal("failed receipt retry unexpectedly succeeded")
	}
	if starts.Load() != 1 || len(store.List()) != 1 {
		t.Fatal("retry executed work or duplicated wake")
	}
}

func TestRelayBalanceGuardBlocksBeforeStartingWorker(t *testing.T) {
	for _, tc := range []struct {
		name    string
		usd     float64
		blocked bool
	}{
		{"insufficient", 0.1, true}, {"exactly_one_turn", 0.46, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, platform, _, id := taskRelayFixture(t)
			var starts atomic.Int32
			rm, session := taskRelayManager(t, p, platform, nil, &starts)
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, relayBalanceFile), []byte(`{"target":{"round_usd":0.46}}`), 0600); err != nil {
				t.Fatal(err)
			}
			rm.balance = newRelayBalanceGuard(dir)
			rm.balance.cache["target"] = relayBalanceReading{usd: tc.usd, at: time.Now()}
			session.events <- Event{Type: EventResult, Content: "done"}
			_, err := rm.Send(context.Background(), taskRelayRequest(id))
			if tc.blocked {
				if err == nil || !strings.Contains(err.Error(), "余额不够") || starts.Load() != 0 {
					t.Fatalf("dispatch was not blocked before execution: starts=%d err=%v", starts.Load(), err)
				}
			} else if err != nil || starts.Load() != 1 {
				t.Fatalf("funded dispatch failed: starts=%d err=%v", starts.Load(), err)
			}
		})
	}
}
