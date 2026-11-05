package core

import (
	"os"
	"path/filepath"
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

func TestMemberJoinPublishesEventAndHookOnly(t *testing.T) {
	e, store := newMemberTestEngine(t)
	out := filepath.Join(t.TempDir(), "hook.txt")
	sync := false
	e.hooks = NewHookManager("test", []HookConfig{
		{Event: "member.joined", Type: "command", Async: &sync,
			Command: `printf '%s|%s|%s|%s|%s|%s' "$CC_HOOK_EVENT" "$CC_HOOK_USER_ID" "$CC_HOOK_USER_NAME" "$CC_HOOK_GUILD" "$CC_HOOK_GUILD_ID" "$CC_HOOK_TIMESTAMP" >> ` + out},
		{Event: "member.left", Type: "command", Async: &sync, Command: `printf 'left|%s;' "$CC_HOOK_USER_ID" >> ` + out},
	}, "sh", "-c", "")
	p := &stubPlatformEngine{n: "discord"}
	e.OnMemberEvent(p, MemberEvent{GuildID: "g1", GuildName: "conest-e2e-test", UserID: "u1", UserName: "alice", DisplayName: "Alice",
		ChannelID: "c1", SessionKey: "discord:c1"})
	e.OnMemberEvent(p, MemberEvent{Left: true, GuildID: "g1", UserID: "u3", UserName: "carol"})
	if n := len(store.ListByProject("test")); n != 0 {
		t.Fatalf("jobs = %d, want 0: a member event wakes no role", n)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	if !strings.HasPrefix(got, "member.joined|u1|Alice（alice）|conest-e2e-test|g1|20") || !strings.HasSuffix(got, "left|u3;") {
		t.Fatalf("hook output = %q", got)
	}
	evs, err := TailStreamEvents(e.dataDir, 10)
	if err != nil || len(evs) != 2 || evs[0].Type != StreamEventMember || evs[0].Data["action"] != "joined" || evs[1].Data["action"] != "left" {
		t.Fatalf("events = %+v err=%v", evs, err)
	}
}
