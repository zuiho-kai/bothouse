package discord

import (
	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
	"testing"
	"time"
)

type forumInboundEngine struct{ secondary bool }

func (*forumInboundEngine) OnPlatformEvent(core.Platform, core.PlatformEvent) {}
func (h *forumInboundEngine) ResolveTaskForumReply(platform, guild, parent, thread string) (*core.TaskForumReply, bool) {
	if platform != "discord" || guild != "guild" || thread != "post" || (parent != "" && parent != "forum") {
		return nil, false
	}
	if h.secondary {
		return nil, true
	}
	return &core.TaskForumReply{Board: 779, Thread: thread, Chat: "discord:source"}, true
}

func TestTaskForumInboundGateway(t *testing.T) {
	for _, tc := range []struct {
		name                                      string
		bot, webhook, secondary, denied, ordinary bool
		want                                      int
	}{
		{name: "human without mention", want: 1},
		{name: "bot explicitly mentioned", bot: true},
		{name: "webhook masquerading as human", webhook: true},
		{name: "secondary engine", secondary: true},
		{name: "unauthorized person", denied: true},
		{name: "ordinary thread", ordinary: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var delivered []*core.Message
			p := &Platform{botID: "bot", botName: "lead", allowFrom: "*", allowBots: "person", threadIsolation: true}
			if tc.denied {
				p.allowFrom = "other"
			}
			p.SetPlatformEventHandler(&forumInboundEngine{secondary: tc.secondary})
			p.botRoleIDs.Store("guild", "role-bot")
			p.handler = func(_ core.Platform, msg *core.Message) { delivered = append(delivered, msg) }
			s := &discordgo.Session{State: discordgo.NewState()}
			id := "post"
			if tc.ordinary {
				id = "ordinary"
			}
			if err := s.State.GuildAdd(&discordgo.Guild{ID: "guild"}); err != nil {
				t.Fatal(err)
			}
			if err := s.State.ChannelAdd(&discordgo.Channel{ID: id, GuildID: "guild", ParentID: "forum", Type: discordgo.ChannelTypeGuildPublicThread}); err != nil {
				t.Fatal(err)
			}
			m := &discordgo.MessageCreate{Message: &discordgo.Message{ID: "message", GuildID: "guild", ChannelID: id, Timestamp: time.Now(), Author: &discordgo.User{ID: "person", Bot: tc.bot}, Content: "暂停"}}
			if tc.ordinary {
				m.Content = "补充要求"
			}
			if tc.bot {
				m.Content = "<@bot> 补充要求"
				m.Mentions = []*discordgo.User{{ID: "bot"}}
			}
			if tc.webhook {
				m.WebhookID = "hook"
			}
			p.handleMessageCreate(s, m)
			if len(delivered) != tc.want {
				t.Fatalf("delivered=%d, want=%d", len(delivered), tc.want)
			}
			if tc.want != 0 {
				msg := delivered[0]
				if msg.TaskForum == nil || msg.TaskForum.Board != 779 || !msg.Mentioned || msg.FromBot {
					t.Fatalf("wrong metadata: %+v", msg)
				}
				rc := msg.ReplyCtx.(replyContext)
				if rc.channelID != "post" || rc.messageID != "message" || rc.lead != "" {
					t.Fatalf("wrong delivery: %+v", rc)
				}
			}
		})
	}
}
