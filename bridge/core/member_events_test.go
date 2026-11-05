package core

import (
	"os"
	"path/filepath"
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

func TestPlatformEventPublishesOnlyAndHooksFilter(t *testing.T) {
	e, store := newMemberTestEngine(t)
	out := filepath.Join(t.TempDir(), "hook.txt")
	sync := false
	cmd := func(tag string) string {
		return `printf '` + tag + `|%s|%s|%s|%s|%s|%s;' "$CC_HOOK_EVENT" "$CC_HOOK_USER_ID" "$CC_HOOK_USER_NAME" "$CC_HOOK_GUILD" "$CC_HOOK_CHANNEL_ID" "$CC_HOOK_EMOJI" >> ` + out
	}
	e.hooks = NewHookManager("test", []HookConfig{
		{Event: "member.joined", Type: "command", Async: &sync, Command: cmd("join")},
		{Event: "reaction.*", Type: "command", Async: &sync, Command: cmd("react-c2"), Channels: []string{"#general"}},
		{Event: "*", Type: "command", Async: &sync, Command: cmd("bob"), Users: []string{"u2"}, Guilds: []string{"g1"}},
	}, "sh", "-c", "")
	p := &stubPlatformEngine{n: "discord"}
	e.OnPlatformEvent(p, PlatformEvent{Name: HookEventMemberJoined, GuildID: "g1", GuildName: "conest-e2e-test", UserID: "u1", UserName: "alice", DisplayName: "Alice", ChannelID: "c1", SessionKey: "discord:c1"})
	e.OnPlatformEvent(p, PlatformEvent{Name: HookEventReactionAdded, GuildID: "g1", ChannelID: "c1", ChannelName: "random", UserID: "u1", Emoji: "👍"}) // channel filter misses
	e.OnPlatformEvent(p, PlatformEvent{Name: HookEventReactionAdded, GuildID: "g1", ChannelID: "c2", ChannelName: "General", UserID: "u2", UserName: "bob", Emoji: "👍"})
	e.OnPlatformEvent(p, PlatformEvent{Name: HookEventVoiceJoined, GuildID: "g2", ChannelID: "v1", UserID: "u2"}) // guild filter misses
	if n := len(store.ListByProject("test")); n != 0 {
		t.Fatalf("jobs = %d, want 0: an event wakes no role", n)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	want := "join|member.joined|u1|Alice（alice）|conest-e2e-test|c1|;" +
		"react-c2|reaction.added|u2|bob||c2|👍;bob|reaction.added|u2|bob||c2|👍;"
	if string(b) != want {
		t.Fatalf("hook output\n got %q\nwant %q", b, want)
	}
	evs, err := TailStreamEvents(e.dataDir, 10)
	if err != nil || len(evs) != 4 || evs[0].Type != StreamEventPlatform || evs[0].Data["event"] != "member.joined" || evs[3].Data["event"] != "voice.joined" {
		t.Fatalf("events = %+v err=%v", evs, err)
	}
}

func TestMatchEventGroup(t *testing.T) {
	for _, c := range []struct {
		p, e string
		ok   bool
	}{{"member.*", "member.joined", true}, {"member.*", "members.x", false}, {"voice.*", "voice", false}, {"*", "x", true}, {"Member.Joined", "member.joined", true}} {
		if matchEvent(c.p, c.e) != c.ok {
			t.Errorf("matchEvent(%q,%q) != %v", c.p, c.e, c.ok)
		}
	}
	if (&HookConfig{Guilds: []string{"g1"}}).matchFilter(HookEvent{Event: HookEventMessageReceived}) {
		t.Fatal("an event without a server must not match a server-filtered hook")
	}
}
