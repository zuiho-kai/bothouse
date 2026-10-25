package discord

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

func TestRegisterCommands_IncludesDMWithoutGuildDuplicates(t *testing.T) {
	for _, guildID := range []string{"guild", ""} {
		t.Run("guild="+guildID, func(t *testing.T) {
			registered := map[string][]*discordgo.ApplicationCommand{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPut || !strings.HasSuffix(r.URL.Path, "/commands") {
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					http.Error(w, "unexpected", http.StatusNotFound)
					return
				}
				var commands []*discordgo.ApplicationCommand
				if err := json.NewDecoder(r.Body).Decode(&commands); err != nil {
					t.Error(err)
				}
				registered[r.URL.Path] = commands
				_ = json.NewEncoder(w).Encode(commands)
			}))
			defer server.Close()
			p := &Platform{session: newTestDiscordSession(t, server), appID: "app", guildID: guildID, readyCh: make(chan struct{})}
			oldApplications := discordgo.EndpointApplications
			discordgo.EndpointApplications = discordgo.EndpointAPI + "applications"
			t.Cleanup(func() { discordgo.EndpointApplications = oldApplications })
			close(p.readyCh)
			if err := p.RegisterCommands([]core.BotCommandInfo{{Command: "new", Description: "Start a session"}}); err != nil {
				t.Fatal(err)
			}
			global := registered["/api/v"+discordgo.APIVersion+"/applications/app/commands"]
			if len(global) != 1 || global[0].Contexts == nil {
				t.Fatalf("global DM commands missing: %+v", global)
			}
			wantContexts := []discordgo.InteractionContextType{discordgo.InteractionContextBotDM}
			if guildID == "" {
				wantContexts = []discordgo.InteractionContextType{discordgo.InteractionContextGuild, discordgo.InteractionContextBotDM}
			}
			if !reflect.DeepEqual(*global[0].Contexts, wantContexts) || global[0].Name != "new" {
				t.Fatalf("global command = %+v, want contexts %v", global[0], wantContexts)
			}
			if guildID != "" {
				guild := registered["/api/v"+discordgo.APIVersion+"/applications/app/guilds/guild/commands"]
				if len(registered) != 2 || len(guild) != 1 || guild[0].Name != "new" || guild[0].Contexts != nil {
					t.Fatalf("expected one guild registration plus DM-only global registration: %+v", registered)
				}
			} else if len(registered) != 1 {
				t.Fatalf("unexpected registrations: %+v", registered)
			}
		})
	}
}

func TestSlashCommand_DMInteractionRoutesAndReplies(t *testing.T) {
	for _, guildID := range []string{"", "guild"} {
		t.Run("guild="+guildID, func(t *testing.T) {
			var deferred, replied bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/interactions/interaction/token/callback"):
					var response discordgo.InteractionResponse
					_ = json.NewDecoder(r.Body).Decode(&response)
					deferred = response.Type == discordgo.InteractionResponseDeferredChannelMessageWithSource
					w.WriteHeader(http.StatusNoContent)
				case r.Method == http.MethodPatch && strings.HasSuffix(r.URL.Path, "/webhooks/app/token/messages/@original"):
					var edit discordgo.WebhookEdit
					_ = json.NewDecoder(r.Body).Decode(&edit)
					replied = edit.Content != nil && *edit.Content == "Session created"
					_ = json.NewEncoder(w).Encode(discordgo.Message{ID: "reply", ChannelID: "channel"})
				case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/channels/channel"):
					typ := discordgo.ChannelTypeDM
					if guildID != "" {
						typ = discordgo.ChannelTypeGuildText
					}
					_ = json.NewEncoder(w).Encode(discordgo.Channel{ID: "channel", Type: typ})
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					http.Error(w, "unexpected", http.StatusNotFound)
				}
			}))
			defer server.Close()
			s := newTestDiscordSession(t, server)
			p := &Platform{session: s, allowFrom: "user", threadIsolation: true}
			p.channelNameCache.Store("channel", "test")
			var got *core.Message
			p.handler = func(_ core.Platform, msg *core.Message) { got = msg }
			user := &discordgo.User{ID: "user", Username: "tester"}
			i := &discordgo.InteractionCreate{Interaction: &discordgo.Interaction{
				ID: "interaction", AppID: "app", Token: "token", GuildID: guildID, ChannelID: "channel",
				Type: discordgo.InteractionApplicationCommand, User: user,
				Data: discordgo.ApplicationCommandInteractionData{Name: "new", Options: []*discordgo.ApplicationCommandInteractionDataOption{
					{Name: "args", Type: discordgo.ApplicationCommandOptionString, Value: "fresh"},
				}},
			}}
			if guildID != "" {
				i.User = nil
				i.Member = &discordgo.Member{User: user}
			}
			p.handleInteraction(s, i)
			if !deferred || got == nil {
				t.Fatalf("deferred=%v, delivered=%+v", deferred, got)
			}
			if got.Content != "/new fresh" || got.UserID != "user" || got.SessionKey != p.makeSessionKey("channel", "user") || got.Direct != (guildID == "") {
				t.Fatalf("incorrect slash routing: %+v", got)
			}
			if err := p.Reply(t.Context(), got.ReplyCtx, "Session created"); err != nil {
				t.Fatal(err)
			}
			if !replied {
				t.Fatal("slash response did not reach the original interaction")
			}
		})
	}
}
