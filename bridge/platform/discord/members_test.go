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
	events []core.MemberEvent
}

func (m *memberSink) OnPlatformReady(core.Platform)              {}
func (m *memberSink) OnPlatformUnavailable(core.Platform, error) {}
func (m *memberSink) OnMemberEvent(_ core.Platform, ev core.MemberEvent) {
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
	if ev.SessionKey != "discord:c1" || ev.GuildName != "conest-e2e-test" || ev.DisplayName != "Alice" || ev.Left {
		t.Fatalf("event = %+v", ev)
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
