package discord

import (
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// Exercise the same entrypoint registered with Discord, with two recipients and
// separate event copies (each bot receives its own gateway event). No network.
func TestReplyRouting_OtherBotDoesNotTriggerMain(t *testing.T) {
	for _, ping := range []bool{false, true} {
		name := "ping_off"
		if ping {
			name = "ping_on"
		}
		t.Run(name, func(t *testing.T) {
			for _, id := range []string{"100", "200"} {
				var delivered []*core.Message
				p := &Platform{botID: id, botName: id, allowFrom: "*"}
				if id == "100" {
					p.groupReplyAllGuilds = []string{"*"}
				}
				p.botRoleIDs.Store("guild", "role-"+id)
				p.channelNameCache.Store("channel", "test")
				p.handler = func(_ core.Platform, msg *core.Message) { delivered = append(delivered, msg) }
				m := &discordgo.MessageCreate{Message: &discordgo.Message{
					ID: "message", GuildID: "guild", ChannelID: "channel",
					Author: &discordgo.User{ID: "human"}, Timestamp: time.Now(),
					Type: discordgo.MessageTypeReply, Content: "继续修复这个问题",
					MessageReference:  &discordgo.MessageReference{MessageID: "original"},
					ReferencedMessage: &discordgo.Message{Author: &discordgo.User{ID: "200", Bot: true}, Content: "测试回答"},
				}}
				if ping {
					m.Mentions = []*discordgo.User{{ID: "200", Bot: true}}
				}
				p.handleMessageCreate(nil, m)
				want := 0
				if id == "200" {
					want = 1
				}
				if len(delivered) != want {
					t.Errorf("bot %s received %d messages; want %d", id, len(delivered), want)
				}
				if id == "200" && len(delivered) == 1 && !delivered[0].Mentioned {
					t.Error("reply recipient must be addressed even with ping off")
				}
			}
		})
	}
}

func TestReplyRouting_RecipientMatrix(t *testing.T) {
	tests := []struct {
		name, content, target                                 string
		ping, human, missing, forward, broadcast, dm, webhook bool
		wantMain, wantSub                                     bool
	}{
		{name: "own_reply_ping_off", target: "100", wantMain: true},
		{name: "own_reply_ping_on", target: "100", ping: true, wantMain: true},
		// Replying to one bot while @-ing another calls both (2026-10-22, user: 「好像我回你的时候同时艾特彩虹猫，你们都不理我」).
		{name: "reply_sub_at_main", target: "200", ping: true, content: "<@100> 接手", wantMain: true, wantSub: true},
		{name: "reply_main_at_sub", target: "100", ping: true, content: "<@200> 接手", wantMain: true, wantSub: true},
		{name: "nick_mention", target: "200", ping: true, content: "<@!100> 接手", wantMain: true, wantSub: true},
		{name: "role_mention_main", target: "200", ping: true, content: "<@&110> 接手", wantMain: true, wantSub: true},
		{name: "reply_main_role_at_sub", target: "100", ping: true, content: "<@&210> 你也看看", wantMain: true, wantSub: true},
		{name: "reply_main_role_at_sub_ping_off", target: "100", content: "<@&210> 你也看看", wantMain: true, wantSub: true},
		{name: "reply_main_at_third_party", target: "100", content: "<@300> 你看看", wantMain: true},
		{name: "both_explicit", target: "200", content: "<@100> <@200> 一起看", wantMain: true, wantSub: true},
		{name: "third_party_bot", target: "300"},
		{name: "command_reply_only_to_sub", target: "200", content: "/new", wantSub: true},
		{name: "webhook_bot", target: "300", human: true, webhook: true},
		{name: "human_reply", target: "human2", human: true, wantMain: true},
		{name: "deleted_reference", missing: true},
		{name: "deleted_reference_with_automatic_ping", missing: true, target: "200", ping: true},
		{name: "deleted_reference_explicit", missing: true, content: "<@200> 继续", wantSub: true},
		{name: "forward_is_not_reply", target: "200", forward: true, wantMain: true},
		{name: "everyone_enabled", target: "200", content: "@everyone 一起看", broadcast: true, wantMain: true, wantSub: true},
		{name: "everyone_disabled_keeps_reply_target", target: "200", content: "@everyone 继续", wantSub: true},
		{name: "here_enabled", target: "200", content: "@here 一起看", broadcast: true, wantMain: true, wantSub: true},
		{name: "dm_keeps_policy", target: "300", dm: true, wantMain: true, wantSub: true},
		{name: "ordinary_unaddressed", wantMain: true},
		{name: "ordinary_mention", content: "<@200> 继续", wantMain: true, wantSub: true},
		{name: "ordinary_role_mention_sub", content: "<@&210> 继续", wantMain: true, wantSub: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, id := range []string{"100", "200"} {
				var delivered []*core.Message
				p := &Platform{botID: id, botName: id, allowFrom: "*", respondToAtEveryoneAndHere: tt.broadcast}
				if id == "100" {
					p.groupReplyAllGuilds = []string{"*"}
				}
				role := "110"
				if id == "200" {
					role = "210"
				}
				p.botRoleIDs.Store("guild", role)
				p.channelNameCache.Store("channel", "test")
				p.handler = func(_ core.Platform, m *core.Message) { delivered = append(delivered, m) }
				m := &discordgo.MessageCreate{Message: &discordgo.Message{ID: "message", GuildID: "guild", ChannelID: "channel", Author: &discordgo.User{ID: "human"}, Timestamp: time.Now(), Content: tt.content}}
				if m.Content == "" {
					m.Content = "继续修复这个问题"
				}
				if tt.target != "" || tt.missing {
					m.Type = discordgo.MessageTypeReply
					m.MessageReference = &discordgo.MessageReference{MessageID: "original"}
					if !tt.missing {
						m.ReferencedMessage = &discordgo.Message{Author: &discordgo.User{ID: tt.target, Bot: !tt.human}, Content: "旧回答里有 <@100>，不是本次点名"}
					}
				}
				if tt.webhook {
					m.ReferencedMessage.WebhookID = "webhook"
				}
				if tt.ping {
					m.Mentions = []*discordgo.User{{ID: tt.target, Bot: true}}
				}
				if tt.forward {
					m.Type = discordgo.MessageTypeDefault
					m.MessageReference.Type = discordgo.MessageReferenceTypeForward
					m.ReferencedMessage = nil
				}
				if tt.broadcast {
					m.MentionEveryone = true
				}
				if tt.dm {
					m.GuildID = ""
				}
				p.handleMessageCreate(nil, m)
				want := tt.wantMain
				if id == "200" {
					want = tt.wantSub
				}
				if (len(delivered) == 1) != want {
					t.Errorf("bot %s delivered=%d; want received=%v", id, len(delivered), want)
				}
				if len(delivered) == 1 && m.Type == discordgo.MessageTypeReply && !tt.human && !tt.dm && !delivered[0].Mentioned {
					t.Errorf("bot %s must be explicitly addressed", id)
				}
			}
		})
	}
}

// What each bot reads for the user's 2026-10-22 messages: a reply to 100 that @-s 200's role, and a
// bare @ of 200's role. 200 must see it was called (its own @ kept as "@name(你)", not stripped) and
// the bare @ must say the user is waiting; 200's answer is not handed back to 100 (replying to 100 is
// talking to 100, who answers itself).
func TestReplyRouting_CalledBotSeesItsMention(t *testing.T) {
	run := func(id string, m *discordgo.MessageCreate) *core.Message {
		var got *core.Message
		p := &Platform{botID: id, botName: "bot" + id, allowFrom: "*", teamLead: "100"}
		if id == "100" {
			p.groupReplyAllGuilds = []string{"*"}
		}
		p.botRoleIDs.Store("guild", map[string]string{"100": "110", "200": "210"}[id])
		p.channelNameCache.Store("channel", "test")
		p.handler = func(_ core.Platform, msg *core.Message) { got = msg }
		cp := *m.Message
		p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &cp})
		return got
	}
	reply := func(target, content string) *discordgo.MessageCreate {
		return &discordgo.MessageCreate{Message: &discordgo.Message{ID: "m-" + target + content, GuildID: "guild", ChannelID: "channel",
			Author: &discordgo.User{ID: "human"}, Timestamp: time.Now(), Type: discordgo.MessageTypeReply, Content: content,
			MessageReference:  &discordgo.MessageReference{MessageID: "original"},
			ReferencedMessage: &discordgo.Message{Author: &discordgo.User{ID: target, Bot: true, Username: "bot" + target}, Content: "上一条"}}}
	}

	m := reply("100", "<@&210> 你也看看")
	main, sub := run("100", m), run("200", m)
	if main == nil || !main.Mentioned || sub == nil || !sub.Mentioned {
		t.Fatalf("both must be addressed: main=%+v sub=%+v", main, sub)
	}
	if !strings.Contains(sub.Content, "@bot200(你) 你也看看") {
		t.Errorf("sub must see its own @ marked, got %q", sub.Content)
	}
	if lead := sub.ReplyCtx.(replyContext).lead; lead != "" {
		t.Errorf("reply to the lead must not be handed back to it, lead=%q", lead)
	}

	// Explicit @lead @sub in a plain message: the sub still hands its answer back (issue #182).
	plain := &discordgo.MessageCreate{Message: &discordgo.Message{ID: "plain", GuildID: "guild", ChannelID: "channel",
		Author: &discordgo.User{ID: "human"}, Timestamp: time.Now(), Content: "<@100> <@200> 帮我算",
		Mentions: []*discordgo.User{{ID: "100", Bot: true}, {ID: "200", Bot: true}}}}
	if got := run("200", plain); got == nil || got.ReplyCtx.(replyContext).lead != "100" {
		t.Errorf("explicit co-mention must still return to the lead: %+v", got)
	}

	// Reply to the sub and @ the lead: the sub is only the reply target, so the lead answers itself
	// and the sub's answer does not @ it again.
	m = reply("200", "<@100> 你看看")
	if got := run("200", m); got == nil || got.ReplyCtx.(replyContext).lead != "" {
		t.Errorf("sub as reply target must not return to the lead: %+v", got)
	}

	// Reply to the sub without any @: only the sub, and its text is unchanged (old behavior).
	m = reply("200", "继续")
	if run("100", m) != nil {
		t.Error("lead must not get a reply to the sub")
	}
	if got := run("200", m); got == nil || !strings.HasSuffix(got.Content, "\n继续") {
		t.Errorf("sub reply text changed: %+v", got)
	}

	bare := &discordgo.MessageCreate{Message: &discordgo.Message{ID: "bare", GuildID: "guild", ChannelID: "channel",
		Author: &discordgo.User{ID: "human"}, Timestamp: time.Now(), Content: "<@&210>"}}
	got := run("200", bare)
	if got == nil || !got.Mentioned || !strings.Contains(got.Content, "用户 @ 了你，在等你回复") {
		t.Fatalf("bare @ must reach the bot as a call it has to answer: %+v", got)
	}
}
