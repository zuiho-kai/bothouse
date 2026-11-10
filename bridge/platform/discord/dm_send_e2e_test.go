package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// #1352 end to end: `bothouse send --dm` request (same JSON the CLI posts) → API socket → engine → this
// Discord platform → a fake Discord REST server that records every request. The log shows who each
// private chat was opened for and where each message landed.
type fakeDiscord struct {
	mu       sync.Mutex
	log      []string
	members  map[string]bool // guild members
	refuse   map[string]bool // users whose DMs Discord refuses (50007 on message send)
	dmOwner  map[string]string
	threadOK bool
}

func (f *fakeDiscord) note(s string) { f.mu.Lock(); f.log = append(f.log, s); f.mu.Unlock() }

func (f *fakeDiscord) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	path := r.URL.Path[strings.Index(r.URL.Path, "/api/v")+len("/api/v"+discordgo.APIVersion):]
	f.note(fmt.Sprintf("%s %s %s", r.Method, path, strings.TrimSpace(string(body))))
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case r.Method == http.MethodGet && len(parts) == 2 && parts[0] == "channels":
		_ = json.NewEncoder(w).Encode(discordgo.Channel{ID: parts[1], GuildID: "guild1", Type: discordgo.ChannelTypeGuildText})
	case r.Method == http.MethodGet && len(parts) == 4 && parts[0] == "guilds" && parts[2] == "members":
		if !f.members[parts[3]] {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message": "Unknown Member", "code": 10007}`))
			return
		}
		_ = json.NewEncoder(w).Encode(discordgo.Member{User: &discordgo.User{ID: parts[3]}})
	case r.Method == http.MethodPost && path == "/users/@me/channels":
		var req struct {
			RecipientID string `json:"recipient_id"`
		}
		_ = json.Unmarshal(body, &req)
		_ = json.NewEncoder(w).Encode(discordgo.Channel{ID: "dm-" + req.RecipientID, Type: discordgo.ChannelTypeDM})
	case r.Method == http.MethodPost && len(parts) == 3 && parts[0] == "channels" && parts[2] == "messages":
		if strings.HasPrefix(parts[1], "dm-") && f.refuse[strings.TrimPrefix(parts[1], "dm-")] {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"message": "Cannot send messages to this user", "code": 50007}`))
			return
		}
		_ = json.NewEncoder(w).Encode(discordgo.Message{ID: "m", ChannelID: parts[1]})
	case r.Method == http.MethodPost && len(parts) == 3 && parts[2] == "threads":
		_ = json.NewEncoder(w).Encode(discordgo.Channel{ID: "pthread", ParentID: parts[1], GuildID: "guild1", Type: discordgo.ChannelTypeGuildPrivateThread})
	case r.Method == http.MethodPut && len(parts) == 4 && parts[2] == "thread-members":
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message": "unexpected"}`))
	}
}

func postSendSocket(t *testing.T, sock string, req core.SendRequest) (int, string) {
	t.Helper()
	c := &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", sock)
	}}}
	b, _ := json.Marshal(req)
	resp, err := c.Post("http://unix/send", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, strings.TrimSpace(string(out))
}

func TestSendDMEndToEndRecipients(t *testing.T) {
	const owner, member, refusing, channel = "100000000000000001", "200000000000000002", "300000000000000003", "555"
	fake := &fakeDiscord{members: map[string]bool{owner: true, member: true, refusing: true}, refuse: map[string]bool{refusing: true}}
	server := httptest.NewServer(fake)
	defer server.Close()
	session := newTestDiscordSession(t, server)
	oldUsers, oldGuilds := discordgo.EndpointUsers, discordgo.EndpointGuilds
	discordgo.EndpointUsers, discordgo.EndpointGuilds = discordgo.EndpointAPI+"users/", discordgo.EndpointAPI+"guilds/"
	t.Cleanup(func() { discordgo.EndpointUsers, discordgo.EndpointGuilds = oldUsers, oldGuilds })
	session.MaxRestRetries = 0
	p := &Platform{session: session, botID: "bot"}

	dir, err := os.MkdirTemp("/tmp", "dm1352")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	e := core.NewEngine("p", noAgent{}, []core.Platform{p}, "", core.LangEnglish)
	e.SetAdminFrom(owner)
	api, err := core.NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	api.RegisterEngine("p", e)
	api.Start()
	defer api.Stop()
	from := "discord:" + channel + ":" + member // the role's own conversation (CC_SESSION_KEY)

	cases := []struct {
		name     string
		req      core.SendRequest
		wantOpen string // recipient_id of the DM open request
		wantPost string // channel the text landed in
		wantOut  string
	}{
		{"owner: --dm without --to, no member turn (the four roles' existing use)",
			core.SendRequest{Project: "p", DM: true, FromSession: from, Message: "给主人"}, owner, "dm-" + owner, `"status":"ok"`},
		{"member: --dm --to member",
			core.SendRequest{Project: "p", DM: true, DMTo: member, FromSession: from, Message: "给成员的设备码"}, member, "dm-" + member, `"status":"ok"`},
		{"member refuses DMs: private thread",
			core.SendRequest{Project: "p", DM: true, DMTo: refusing, FromSession: from, Message: "给拒收私信的成员"}, refusing, "pthread", "private thread"},
	}
	for _, c := range cases {
		fake.mu.Lock()
		fake.log = nil
		fake.mu.Unlock()
		code, out := postSendSocket(t, api.SocketPath(), c.req)
		fake.mu.Lock()
		log := append([]string(nil), fake.log...)
		fake.mu.Unlock()
		t.Logf("== %s\nCLI response: %d %s\nDiscord requests:\n  %s", c.name, code, out, strings.Join(log, "\n  "))
		if code != http.StatusOK || !strings.Contains(out, c.wantOut) {
			t.Errorf("%s: response %d %s", c.name, code, out)
		}
		opened, posted := "", ""
		for _, l := range log {
			if strings.HasPrefix(l, "POST /users/@me/channels ") {
				var b struct {
					RecipientID string `json:"recipient_id"`
				}
				_ = json.Unmarshal([]byte(strings.TrimPrefix(l, "POST /users/@me/channels ")), &b)
				opened = b.RecipientID
			}
			if strings.HasPrefix(l, "POST /channels/") && strings.Contains(l, "/messages ") && !strings.Contains(l, "50007") {
				posted = strings.Split(strings.TrimPrefix(l, "POST /channels/"), "/")[0]
			}
		}
		if opened != c.wantOpen {
			t.Errorf("%s: DM opened for %q, want %q", c.name, opened, c.wantOpen)
		}
		if posted != c.wantPost {
			t.Errorf("%s: last message posted to %q, want %q", c.name, posted, c.wantPost)
		}
	}
}
