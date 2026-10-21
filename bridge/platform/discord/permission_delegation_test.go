package discord

import (
	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
	"strings"
	"testing"
	"time"
)

func TestDelegatedPermissionGateway(t *testing.T) {
	token := strings.Repeat("a", 32)
	for _, tc := range []struct {
		name, actor, content, webhook string
		main                          bool
		want                          int
	}{
		{name: "authorized", actor: "101", content: "<@200> /permit " + token + " allow", want: 1},
		{name: "second approver", actor: "102", content: "<@200> /permit " + token + " deny", want: 1},
		{name: "main bot", actor: "101", content: "<@200> /permit " + token + " allow", main: true, want: 1},
		{name: "not approver", actor: "103", content: "<@200> /permit " + token + " allow"},
		{name: "webhook", actor: "101", content: "<@200> /permit " + token + " allow", webhook: "999"},
		{name: "missing mention", actor: "101", content: "/permit " + token + " allow", main: true},
		{name: "bad key", actor: "101", content: "<@200> /permit old allow"},
		{name: "wildcard approval", actor: "101", content: "<@200> /permit " + token + " allow_all"},
		{name: "extra text", actor: "101", content: "<@200> /permit " + token + " allow then do more"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var received []*core.Message
			p := &Platform{botID: "200", permissionApprovers: []string{"101", "102"}, allowBots: "101,102,103", shareSessionInChannel: true}
			if tc.main {
				p.groupReplyAllGuilds = []string{"*"}
			}
			p.botRoleIDs.Store("guild", "role")
			p.channelNameCache.Store("channel", "test")
			p.handler = func(_ core.Platform, m *core.Message) { received = append(received, m) }
			p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{
				ID: "message", GuildID: "guild", ChannelID: "channel", Timestamp: time.Now(), WebhookID: tc.webhook,
				Author: &discordgo.User{ID: tc.actor, Username: "spoofed name", Bot: true}, Content: tc.content, Mentions: []*discordgo.User{{ID: "200"}},
			}})
			if len(received) != tc.want {
				t.Fatalf("received=%d want=%d", len(received), tc.want)
			}
			if tc.want == 1 {
				m := received[0]
				if !m.FromBot || !m.IsPermissionResponse || m.PermissionApprovalID != token || m.UserID != tc.actor || m.SessionKey != "discord:channel" {
					t.Fatalf("wrong authenticated decision: %+v", m)
				}
			}
		})
	}
}

func TestPermissionApproverConfig(t *testing.T) {
	for _, raw := range []any{"*", "name", 123, "123,<@456>"} {
		if _, err := parsePermissionApprovers(raw); err == nil {
			t.Fatalf("accepted %v", raw)
		}
	}
	ids, err := parsePermissionApprovers(" 101,102,101 ")
	if err != nil || len(ids) != 2 {
		t.Fatalf("%v %v", ids, err)
	}
	p := &Platform{botID: "101", permissionApprovers: ids}
	peers, target := p.PermissionDelegationTargets()
	if peers != "<@102>" || target != "<@101>" {
		t.Fatalf("self-recursive routing: %s %s", peers, target)
	}
	if p.CanApprovePermission("spoofed") || !p.CanApprovePermission("101") {
		t.Fatal("not exact ID matching")
	}
}
