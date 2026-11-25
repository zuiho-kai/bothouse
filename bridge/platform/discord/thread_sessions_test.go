package discord

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

func TestThreadSessionPerUser_MessageAndCommands(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/callback") {
			t.Errorf("unexpected Discord request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	s := newTestDiscordSession(t, server)
	parent := &discordgo.Channel{ID: "parent", GuildID: "guild", Type: discordgo.ChannelTypeGuildText}
	thread := &discordgo.Channel{ID: "thread", GuildID: "guild", Type: discordgo.ChannelTypeGuildPublicThread, ParentID: parent.ID}
	if err := s.State.GuildAdd(&discordgo.Guild{ID: "guild", Channels: []*discordgo.Channel{parent}, Threads: []*discordgo.Channel{thread}}); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"default", "per-user"} {
		t.Run(mode, func(t *testing.T) {
			opts := map[string]any{"token": "test", "thread_isolation": true, "share_session_in_channel": true, "group_reply_all": true, "allow_from": "*"}
			if mode == "per-user" {
				opts["thread_session_per_user"] = true
			}
			pl, err := New(opts)
			if err != nil {
				t.Fatal(err)
			}
			p := platformOf(t, pl)
			p.session = s
			p.botID = "bot"
			p.botRoleIDs.Store("guild", "role")
			p.channelNameCache.Store(parent.ID, "chat")
			p.channelNameCache.Store(thread.ID, "topic")
			starts := 0
			p.threadOps = fakeThreadOps{
				resolveChannel: s.State.Channel,
				startThread: func(channel, message, name string, duration int) (*discordgo.Channel, error) {
					starts++
					return thread, nil
				},
			}
			var got *core.Message
			p.handler = func(_ core.Platform, msg *core.Message) { got = msg }
			sessions := core.NewSessionManager("")
			for _, step := range []struct{ id, channel, user, action string }{
				{"1", parent.ID, "alice", "message"},
				{"2", thread.ID, "bob", "message"},
				{"3", thread.ID, "alice", "message"},
				{"4", thread.ID, "alice", "slash"},
				{"5", thread.ID, "bob", "button"},
			} {
				got = nil
				user := &discordgo.User{ID: step.user}
				switch step.action {
				case "message":
					p.handleMessageCreate(s, &discordgo.MessageCreate{Message: &discordgo.Message{
						ID: step.id, ChannelID: step.channel, GuildID: "guild", Author: user, Content: "继续", Timestamp: time.Now(),
					}})
				case "slash", "button":
					i := &discordgo.Interaction{ID: step.id, ChannelID: step.channel, GuildID: "guild", Member: &discordgo.Member{User: user},
						Type: discordgo.InteractionApplicationCommand, Data: discordgo.ApplicationCommandInteractionData{Name: "history"}}
					if step.action == "button" {
						i.Type = discordgo.InteractionMessageComponent
						i.Data = discordgo.MessageComponentInteractionData{CustomID: "cmd:/history"}
					}
					p.handleInteraction(s, &discordgo.InteractionCreate{Interaction: i})
				}
				want := "discord:thread"
				if mode == "per-user" {
					want += ":" + step.user
				}
				if got == nil || got.SessionKey != want || got.ChannelKey != parent.ID {
					t.Fatalf("%s from %s: got %+v, want session %s under %s", step.action, step.user, got, want, parent.ID)
				}
				var target string
				switch rc := got.ReplyCtx.(type) {
				case replyContext:
					target = rc.targetChannelID()
				case *interactionReplyCtx:
					target = rc.channelID
				}
				if target != thread.ID {
					t.Fatalf("%s reply target = %q, want %q", step.action, target, thread.ID)
				}
				session := sessions.GetOrCreateActive(got.SessionKey)
				if step.action == "message" {
					session.AddHistory("user", step.user)
				} else {
					if got.Content != "/history" {
						t.Fatalf("command = %q, want /history", got.Content)
					}
					var authors []string
					for _, entry := range session.GetHistory(0) {
						authors = append(authors, entry.Content)
					}
					wantAuthors := "alice,bob,alice"
					if mode == "per-user" && step.user == "alice" {
						wantAuthors = "alice,alice"
					} else if mode == "per-user" {
						wantAuthors = "bob"
					}
					if strings.Join(authors, ",") != wantAuthors {
						t.Fatalf("%s history authors = %v, want %s", step.user, authors, wantAuthors)
					}
				}
				t.Logf("%s  %s  %s  session=%s  reply=%s  history=%d", step.id, step.user, step.action, got.SessionKey, target, session.HistoryLen())
			}
			if starts != 1 {
				t.Fatalf("created %d threads, want one", starts)
			}
		})
	}
}

func TestThreadSessionPerUser_Fallbacks(t *testing.T) {
	lookupErr := errors.New("channel unavailable")
	ops := fakeThreadOps{
		resolveChannel: func(id string) (*discordgo.Channel, error) {
			if id == "unknown" {
				return nil, lookupErr
			}
			return &discordgo.Channel{ID: id, Type: discordgo.ChannelTypeGuildText}, nil
		},
		startThread: func(string, string, string, int) (*discordgo.Channel, error) { return nil, lookupErr },
	}
	p := &Platform{threadIsolation: true, threadSessionPerUser: true, shareSessionInChannel: true, threadOps: ops}
	for _, tc := range []struct {
		channel, key string
	}{
		{"unknown", "discord:unknown:user"},
		{"parent", "discord:parent"},
	} {
		m := &discordgo.MessageCreate{Message: &discordgo.Message{ID: "post", ChannelID: tc.channel, Author: &discordgo.User{ID: "user"}}}
		key, rc, _, err := p.resolveThreadReplyContext(m)
		if !errors.Is(err, lookupErr) || rc.targetChannelID() != tc.channel || key != tc.key {
			t.Errorf("fallback for %s = %q, %+v, %v", tc.channel, key, rc, err)
		}
		if key, _ := p.interactionKeys(tc.channel, "user"); key != tc.key {
			t.Errorf("interaction in %s = %q, want %q", tc.channel, key, tc.key)
		}
	}
}

func TestThreadSessionPerUser_Configuration(t *testing.T) {
	opts := map[string]any{"token": "test", "share_session_in_channel": true, "permission_approvers": "101", "thread_session_per_user": true}
	pl, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	p := platformOf(t, pl)
	if key, _ := p.interactionKeys("channel", "member"); key != "discord:channel" {
		t.Fatalf("channel key with thread isolation off = %q", key)
	}
	opts["thread_isolation"] = true
	if _, err := New(opts); err == nil {
		t.Fatal("delegated approvals require a shared session")
	}
	delete(opts, "permission_approvers")
	opts["thread_session_per_user"] = false
	pl, err = New(opts)
	if err != nil {
		t.Fatal(err)
	}
	opts["thread_session_per_user"] = true
	if restart := platformOf(t, pl).ReloadOptions(opts); len(restart) != 1 || restart[0] != "thread_session_per_user" {
		t.Fatalf("restart keys = %v", restart)
	}
}
