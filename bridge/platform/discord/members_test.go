package discord

import (
	"fmt"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

type memberSink struct {
	events []core.PlatformEvent
}

func (m *memberSink) OnPlatformReady(core.Platform)              {}
func (m *memberSink) OnPlatformUnavailable(core.Platform, error) {}
func (m *memberSink) OnPlatformEvent(_ core.Platform, ev core.PlatformEvent) {
	m.events = append(m.events, ev)
}
func (m *memberSink) OnMemberIntent(core.Platform, bool, core.MemberIntentNotice) {}

func TestMemberAddFillsSystemChannel(t *testing.T) {
	sink := &memberSink{}
	p := &Platform{botID: "me", shareSessionInChannel: true, lifecycleHandler: sink}
	s := &discordgo.Session{State: discordgo.NewState()}
	if err := s.State.GuildAdd(&discordgo.Guild{ID: "g1", Name: "conest-e2e-test", SystemChannelID: "c1"}); err != nil {
		t.Fatal(err)
	}
	p.handleMemberAdd(s, &discordgo.GuildMemberAdd{Member: &discordgo.Member{GuildID: "g1", User: &discordgo.User{ID: "u1", Username: "alice", GlobalName: "Alice"}}})
	p.handleMemberAdd(s, &discordgo.GuildMemberAdd{Member: &discordgo.Member{GuildID: "g1", User: &discordgo.User{ID: "me", Username: "self"}}}) // own join: ignored
	if len(sink.events) != 1 {
		t.Fatalf("events = %d", len(sink.events))
	}
	ev := sink.events[0]
	if ev.Name != core.HookEventMemberJoined || ev.SessionKey != "discord:c1" || ev.GuildName != "conest-e2e-test" || ev.DisplayName != "Alice" {
		t.Fatalf("event = %+v", ev)
	}
}

func TestPlatformEventsFromGateway(t *testing.T) {
	sink := &memberSink{}
	p := &Platform{botID: "me", shareSessionInChannel: true, lifecycleHandler: sink}
	s := &discordgo.Session{State: discordgo.NewState()}
	_ = s.State.GuildAdd(&discordgo.Guild{ID: "g1", Name: "srv", Channels: []*discordgo.Channel{{ID: "c1", GuildID: "g1", Name: "general"}, {ID: "v1", GuildID: "g1", Name: "voice"}}})
	r := func(uid string) *discordgo.MessageReaction {
		return &discordgo.MessageReaction{UserID: uid, MessageID: "m1", ChannelID: "c1", GuildID: "g1", Emoji: discordgo.Emoji{Name: "👍"}}
	}
	p.handleReactionAdd(s, &discordgo.MessageReactionAdd{MessageReaction: r("u1")})
	p.handleReactionAdd(s, &discordgo.MessageReactionAdd{MessageReaction: r("me")}) // own reaction: ignored
	p.handleReactionRemove(s, &discordgo.MessageReactionRemove{MessageReaction: r("u1")})
	p.handleChannelCreate(s, &discordgo.ChannelCreate{Channel: &discordgo.Channel{ID: "c9", GuildID: "g1", Name: "new"}})
	p.handleChannelDelete(s, &discordgo.ChannelDelete{Channel: &discordgo.Channel{ID: "c9", GuildID: "g1", Name: "new"}})
	p.handleThreadCreate(s, &discordgo.ThreadCreate{Channel: &discordgo.Channel{ID: "t1", GuildID: "g1", ParentID: "c1", OwnerID: "u1"}, NewlyCreated: true})
	p.handleThreadCreate(s, &discordgo.ThreadCreate{Channel: &discordgo.Channel{ID: "t2", GuildID: "g1", ParentID: "c1"}}) // joined old thread: ignored
	p.handleVoiceState(s, &discordgo.VoiceStateUpdate{VoiceState: &discordgo.VoiceState{GuildID: "g1", UserID: "u1", ChannelID: "v1"}})
	p.handleVoiceState(s, &discordgo.VoiceStateUpdate{VoiceState: &discordgo.VoiceState{GuildID: "g1", UserID: "u1", ChannelID: "v1", SelfMute: true}, BeforeUpdate: &discordgo.VoiceState{ChannelID: "v1"}}) // mute: ignored
	p.handleVoiceState(s, &discordgo.VoiceStateUpdate{VoiceState: &discordgo.VoiceState{GuildID: "g1", UserID: "u1", ChannelID: "v2"}, BeforeUpdate: &discordgo.VoiceState{ChannelID: "v1"}})
	p.handleVoiceState(s, &discordgo.VoiceStateUpdate{VoiceState: &discordgo.VoiceState{GuildID: "g1", UserID: "u1"}, BeforeUpdate: &discordgo.VoiceState{ChannelID: "v2"}})
	p.handlePinsUpdate(s, &discordgo.ChannelPinsUpdate{GuildID: "g1", ChannelID: "c1"})
	var got []string
	for _, ev := range sink.events {
		got = append(got, string(ev.Name)+"@"+ev.ChannelID)
	}
	want := "reaction.added@c1 reaction.removed@c1 channel.created@c9 channel.deleted@c9 thread.created@c1 voice.joined@v1 voice.moved@v2 voice.left@v2 pins.updated@c1"
	if strings.Join(got, " ") != want {
		t.Fatalf("events\n got %s\nwant %s", strings.Join(got, " "), want)
	}
	if e := sink.events[0]; e.GuildName != "srv" || e.ChannelName != "general" || e.Emoji != "👍" || e.MessageID != "m1" {
		t.Fatalf("reaction = %+v", e)
	}
	if e := sink.events[6]; e.FromChannel != "v1" {
		t.Fatalf("moved = %+v", e)
	}
}

func TestDisallowedIntentsAndNotice(t *testing.T) {
	if !isDisallowedIntents(fmt.Errorf("open: %w", &websocket.CloseError{Code: 4014, Text: "Disallowed intent(s)."})) {
		t.Fatal("4014 not recognised")
	}
	if isDisallowedIntents(&websocket.CloseError{Code: 4004}) {
		t.Fatal("4004 is not an intent error")
	}
	p := &Platform{appID: "123"}
	if p.PlatformNotice() != "" {
		t.Fatal("unknown state should not warn")
	}
	p.membersIntent.Store(membersOff)
	if n := p.PlatformNotice(); !strings.Contains(n, "SERVER MEMBERS INTENT") || !strings.Contains(n, "/applications/123/bot") {
		t.Fatalf("notice = %q", n)
	}
}
