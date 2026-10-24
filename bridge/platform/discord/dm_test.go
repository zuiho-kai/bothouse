package discord

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// OpenDM asks Discord for the private channel with the user (POST /users/@me/channels) and returns
// the same session key an incoming message in that channel gets; sending to it reaches that channel.
func TestOpenDM_ResolvesPrivateChannelAndSends(t *testing.T) {
	var openedFor, postedTo, postedBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/users/@me/channels"):
			var req struct {
				RecipientID string `json:"recipient_id"`
			}
			_ = json.Unmarshal(body, &req)
			openedFor = req.RecipientID
			_ = json.NewEncoder(w).Encode(discordgo.Channel{ID: "dm-chan", Type: discordgo.ChannelTypeDM})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/channels/dm-chan/messages"):
			postedTo, postedBody = "dm-chan", string(body)
			_ = json.NewEncoder(w).Encode(discordgo.Message{ID: "m1", ChannelID: "dm-chan"})
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected", http.StatusNotFound)
		}
	}))
	defer server.Close()
	session := newTestDiscordSession(t, server)
	oldUsers := discordgo.EndpointUsers
	discordgo.EndpointUsers = discordgo.EndpointAPI + "users/"
	t.Cleanup(func() { discordgo.EndpointUsers = oldUsers })

	p := &Platform{session: session, botID: "bot"}
	key, err := p.OpenDM("100000000000000001")
	if err != nil {
		t.Fatalf("OpenDM: %v", err)
	}
	if openedFor != "100000000000000001" {
		t.Fatalf("opened DM for %q", openedFor)
	}
	if want := p.makeSessionKey("dm-chan", "100000000000000001"); key != want {
		t.Fatalf("key = %q, want %q (the key an incoming DM gets)", key, want)
	}
	rctx, err := p.ReconstructReplyCtx(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Send(t.Context(), rctx, "悄悄话"); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if postedTo != "dm-chan" || !strings.Contains(postedBody, "悄悄话") {
		t.Fatalf("posted to %q body %q", postedTo, postedBody)
	}
}

// A user's message in a private chat carries no @; it is marked Direct and core decides
// (by owner) whether it bypasses the gate.
func TestDirectMessageIsAddressed(t *testing.T) {
	var got []*core.Message
	p := &Platform{botID: "bot", botName: "bot", allowFrom: "user"}
	p.channelNameCache.Store("dm-chan", "dm")
	p.handler = func(_ core.Platform, msg *core.Message) { got = append(got, msg) }
	p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{
		ID: "m1", ChannelID: "dm-chan", Author: &discordgo.User{ID: "user"},
		Timestamp: time.Now(), Content: "在吗",
	}})
	if len(got) != 1 {
		t.Fatalf("delivered %d messages", len(got))
	}
	if !got[0].Direct {
		t.Fatalf("DM must be marked direct: direct=%v", got[0].Direct)
	}
	if got[0].SessionKey != p.makeSessionKey("dm-chan", "user") {
		t.Fatalf("session key %q", got[0].SessionKey)
	}

	// A guild message is never Direct.
	got = nil
	p.groupReplyAllGuilds = []string{"*"}
	p.botRoleIDs.Store("guild", "role-bot")
	p.channelNameCache.Store("chan", "chan")
	p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{
		ID: "m2", GuildID: "guild", ChannelID: "chan", Author: &discordgo.User{ID: "user"},
		Timestamp: time.Now(), Content: "大家好",
	}})
	if len(got) != 1 || got[0].Direct || got[0].Mentioned {
		t.Fatalf("guild message without @ must stay undirected: %+v", got)
	}
}
