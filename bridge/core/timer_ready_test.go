package core

import (
	"strings"
	"testing"
	"time"
)

// 2026-10-23 00:31: a timer due at startup ran before Discord connected and the nil
// session panicked the bridge. Timers on async platforms wait for ready first.
func TestWaitTimerPlatformReadyWaitsForAsyncPlatform(t *testing.T) {
	p := &stubLifecyclePlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	go func() {
		time.Sleep(300 * time.Millisecond)
		e.OnPlatformReady(p)
	}()
	start := time.Now()
	if err := e.waitTimerPlatformReady(p); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) < 250*time.Millisecond {
		t.Fatal("did not wait for the platform to become ready")
	}
}

func TestWaitTimerPlatformReadyTimesOut(t *testing.T) {
	old := timerPlatformReadyTimeout
	timerPlatformReadyTimeout = 300 * time.Millisecond
	t.Cleanup(func() { timerPlatformReadyTimeout = old })
	p := &stubLifecyclePlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	if err := e.waitTimerPlatformReady(p); err == nil || !strings.Contains(err.Error(), "not ready") {
		t.Fatalf("err = %v", err)
	}
}

func TestWaitTimerPlatformReadySyncPlatformImmediate(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	if err := e.waitTimerPlatformReady(p); err != nil {
		t.Fatal(err)
	}
}

// A due timer whose async platform is still not ready after the wait must stay
// pending (not fired) and run once the platform connects, instead of being lost.
func TestTimerSchedulerRequeuesWhenPlatformNotReady(t *testing.T) {
	old := timerPlatformReadyTimeout
	timerPlatformReadyTimeout = 200 * time.Millisecond
	t.Cleanup(func() { timerPlatformReadyTimeout = old })

	p := &stubLifecyclePlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })

	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewTimerStore: %v", err)
	}
	sched := NewTimerScheduler(store)
	t.Cleanup(sched.Stop)
	sched.RegisterEngine("test", e)

	job := &TimerJob{
		ID:          "notready1",
		Project:     "test",
		SessionKey:  "discord:chan1:user1",
		ScheduledAt: time.Now(),
		Prompt:      "ping",
		CreatedAt:   time.Now(),
	}
	if err := sched.AddJob(job); err != nil {
		t.Fatalf("AddJob: %v", err)
	}

	// Several ready-timeouts pass with the platform still down.
	time.Sleep(700 * time.Millisecond)
	if got := store.Get("notready1"); got == nil || got.Fired {
		t.Fatalf("job fired while platform not ready: %+v", got)
	}

	e.OnPlatformReady(p)
	deadline := time.Now().Add(3 * time.Second)
	for {
		got := store.Get("notready1")
		if got != nil && got.Fired {
			if strings.Contains(got.LastError, "not ready") {
				t.Fatalf("job fired with not-ready error after platform became ready: %q", got.LastError)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("job did not run after platform became ready")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
