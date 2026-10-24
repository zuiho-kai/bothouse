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
