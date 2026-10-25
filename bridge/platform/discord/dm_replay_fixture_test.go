package discord

import (
	"fmt"
	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
	"testing"
	"time"
)

func TestDMReplayFixture(t *testing.T) {
	p := &Platform{botID: "100", botName: "testbot", allowFrom: "*"}
	p.channelNameCache.Store("D1", "test-dm")
	var messages []*core.Message
	p.handler = func(_ core.Platform, m *core.Message) { m.ReplyCtx = nil; messages = append(messages, m) }
	for i, text := range []string{"跑一个很长的任务", "停", "别做这个，改做X"} {
		p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: &discordgo.Message{ID: fmt.Sprint(i + 1), ChannelID: "D1", Author: &discordgo.User{ID: "U1"}, Timestamp: time.Now(), Content: text}})
	}
	if len(messages) != 3 {
		t.Fatalf("got %d", len(messages))
	}
	for _, m := range messages {
		if !m.Direct {
			t.Fatal("not direct")
		}
	}
	for i, m := range messages {
		if m.Content != []string{"跑一个很长的任务", "停", "别做这个，改做X"}[i] || m.UserID != messages[0].UserID || m.SessionKey != messages[0].SessionKey {
			t.Fatalf("DM routing changed: %+v", m)
		}
	}
}
