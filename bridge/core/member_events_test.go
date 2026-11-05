package core

import (
	"strings"
	"testing"
)

func newMemberTestEngine(t *testing.T) (*Engine, *TimerStore) {
	t.Helper()
	e := newTestEngine()
	e.dataDir = t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store) // no engine registered: a due job is marked fired, not run
	e.SetTimerScheduler(ts)
	t.Cleanup(ts.Stop)
	return e, store
}

func TestMemberJoinWakesSoloBotInSystemChannel(t *testing.T) {
	e, store := newMemberTestEngine(t)
	p := &stubPlatformEngine{n: "discord"}
	e.OnMemberEvent(p, MemberEvent{GuildID: "g1", GuildName: "conest-e2e-test", UserID: "u1", UserName: "alice", DisplayName: "Alice",
		ChannelID: "c1", SessionKey: "discord:c1"})
	jobs := store.ListByProject("test")
	if len(jobs) != 1 {
		t.Fatalf("jobs = %d, want 1", len(jobs))
	}
	j := jobs[0]
	if j.SessionKey != "discord:c1" || !j.WaitUserQuiet || !strings.Contains(j.Prompt, "<@u1>") || !strings.Contains(j.Prompt, "欢迎") {
		t.Fatalf("job = %+v", j)
	}
	evs, err := TailStreamEvents(e.dataDir, 10)
	if err != nil || len(evs) != 1 || evs[0].Type != StreamEventMember || evs[0].Data["action"] != "joined" {
		t.Fatalf("events = %+v err=%v", evs, err)
	}
}

func TestMemberLeaveOrNoChannelOnlyRecorded(t *testing.T) {
	e, store := newMemberTestEngine(t)
	p := &stubPlatformEngine{n: "discord"}
	e.OnMemberEvent(p, MemberEvent{Left: true, GuildID: "g1", UserID: "u3", UserName: "carol", ChannelID: "c1", SessionKey: "discord:c1"})
	e.OnMemberEvent(p, MemberEvent{GuildID: "g1", UserID: "u2", UserName: "bob"}) // server without a system channel
	if n := len(store.ListByProject("test")); n != 0 {
		t.Fatalf("jobs = %d, want 0", n)
	}
	if evs, _ := TailStreamEvents(e.dataDir, 10); len(evs) != 2 {
		t.Fatalf("events = %d, want 2", len(evs))
	}
}
