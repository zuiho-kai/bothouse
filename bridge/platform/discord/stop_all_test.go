package discord

import (
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// "/stop all" without a mention reaches every bot in the channel; other
// unmentioned guild messages are still dropped.
func TestHandleMessageCreate_StopAllWithoutMention(t *testing.T) {
	run := func(id, content string) *core.Message {
		var got *core.Message
		p := &Platform{botID: id, botName: "bot" + id, allowFrom: "*", teamLead: "100"}
		p.channelNameCache.Store("channel", "test")
		p.handler = func(_ core.Platform, msg *core.Message) { got = msg }
		p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{ID: "m-" + id + content,
			GuildID: "guild", ChannelID: "channel", Author: &discordgo.User{ID: "human"},
			Timestamp: time.Now(), Content: content}})
		return got
	}
	for _, id := range []string{"100", "200"} {
		if got := run(id, "/stop all"); got == nil || got.Content != "/stop all" {
			t.Errorf("bot %s did not receive /stop all: %+v", id, got)
		}
		if got := run(id, "hello"); got != nil {
			t.Errorf("bot %s received an unmentioned message: %+v", id, got)
		}
	}
}

// A bare stop word with no @ and no reply reaches every bot like "/stop all";
// "@bot 停", a name call, a reply, or a longer sentence does not reach the
// bots it does not call.
func TestHandleMessageCreate_BareStopWithoutMention(t *testing.T) {
	run := func(id string, m *discordgo.Message) *core.Message {
		var got *core.Message
		p := &Platform{botID: id, botName: "bot" + id, allowFrom: "*", teamLead: "100"}
		p.channelNameCache.Store("channel", "test")
		p.handler = func(_ core.Platform, msg *core.Message) { got = msg }
		mm := *m
		mm.ID = "m-" + id + m.Content
		mm.GuildID, mm.ChannelID = "guild", "channel"
		mm.Author = &discordgo.User{ID: "human"}
		mm.Timestamp = time.Now()
		p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &mm})
		return got
	}
	for _, id := range []string{"100", "200"} {
		for _, word := range []string{"停", "暂停", "stop", "停。"} {
			got := run(id, &discordgo.Message{Content: word})
			if got == nil || got.Content != word || got.Mentioned {
				t.Errorf("bot %s did not receive bare %q as unaddressed: %+v", id, word, got)
			}
		}
		for _, word := range []string{"停下来聊聊", "bot200，停"} {
			if got := run(id, &discordgo.Message{Content: word}); got != nil {
				t.Errorf("bot %s received %q: %+v", id, word, got)
			}
		}
	}
	// "@bot200 停": only bot200 gets it, as a mention.
	at := &discordgo.Message{Content: "<@200> 停", Mentions: []*discordgo.User{{ID: "200"}}}
	if got := run("100", at); got != nil {
		t.Errorf("bot 100 received a stop addressed to bot 200: %+v", got)
	}
	if got := run("200", at); got == nil || !got.Mentioned {
		t.Errorf("bot 200 did not receive its own stop as a mention: %+v", got)
	}
	// A role mention or @everyone is a recipient too.
	if got := run("100", &discordgo.Message{Content: "<@&999> 停", MentionRoles: []string{"999"}}); got != nil {
		t.Errorf("bot 100 received a stop addressed to a role: %+v", got)
	}
}

func TestIsBareStop(t *testing.T) {
	base := func(content string) *discordgo.MessageCreate {
		return &discordgo.MessageCreate{Message: &discordgo.Message{Content: content, GuildID: "g", Author: &discordgo.User{ID: "u"}}}
	}
	if !isBareStop(base("停"), false, "100") {
		t.Fatal("bare 停 should be an unaddressed stop")
	}
	if isBareStop(base("停"), true, "100") {
		t.Error("a stop that mentions this bot is not unaddressed")
	}
	m := base("停")
	m.ReferencedMessage = &discordgo.Message{ID: "x"}
	if isBareStop(m, false, "100") {
		t.Error("a reply is not unaddressed")
	}
	m = base("停")
	m.Type = discordgo.MessageTypeReply
	if isBareStop(m, false, "100") {
		t.Error("a reply (deleted reference) is not unaddressed")
	}
	m = base("停")
	m.MentionEveryone = true
	if isBareStop(m, false, "100") {
		t.Error("@everyone 停 is not unaddressed")
	}
	m = base("<@200> 停")
	m.Mentions = []*discordgo.User{{ID: "200"}}
	if isBareStop(m, false, "100") {
		t.Error("@other 停 is not unaddressed")
	}
	if isBareStop(base("肥鱼，停"), false, "100") {
		t.Error("a name call 肥鱼，停 is not unaddressed")
	}
}
