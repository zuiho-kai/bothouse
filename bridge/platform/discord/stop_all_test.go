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
