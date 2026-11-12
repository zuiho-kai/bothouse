package core

import (
	"strings"
	"testing"
	"time"
)

// #1492 常识：被跳过要留一句话。A reminder the user set, due while the bridge was down for more
// than the grace, was marked fired with an error and never mentioned to anyone.
func TestStaleTimerTellsTheChat(t *testing.T) {
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	job := &TimerJob{ID: "stale2", Project: "test", SessionKey: "test:chat", Description: "提醒交房租",
		ScheduledAt: time.Now().Add(-time.Hour), Prompt: "提醒我交房租", CreatedAt: time.Now().Add(-2 * time.Hour)}
	if err := store.Add(job); err != nil {
		t.Fatal(err)
	}
	platform := &shellJobPlatform{stubPlatformEngine{n: "test"}}
	engine := NewEngine("test", &stubAgent{}, []Platform{platform}, "", LangChinese)
	sched := NewTimerScheduler(store)
	sched.RegisterEngine("test", engine)
	if err := sched.Start(); err != nil {
		t.Fatal(err)
	}
	defer sched.Stop()
	deadline := time.Now().Add(3 * time.Second)
	for {
		for _, m := range platform.getSent() {
			if strings.Contains(m, "提醒交房租") && strings.Contains(m, "错过") {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("no notice for the missed timer; sent: %q", platform.getSent())
		}
		time.Sleep(20 * time.Millisecond)
	}
}
