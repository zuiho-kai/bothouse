package telegram

import (
	"context"
	"github.com/chenhg5/cc-connect/core"
	"github.com/go-telegram/bot/models"
	"net/http"
	"testing"
	"time"
)

func TestDMReplayFixture(t *testing.T) {
	p := &Platform{token: "token", httpClient: &http.Client{}, allowFrom: "*"}
	p.bot = newStubTelegramBot()
	p.selfUser = &models.User{ID: 42, Username: "testbot"}
	var messages []*core.Message
	p.handler = func(_ core.Platform, m *core.Message) { m.ReplyCtx = nil; messages = append(messages, m) }
	for i, text := range []string{"跑一个很长的任务", "停", "别做这个，改做X"} {
		p.handleMessage(context.Background(), &models.Message{ID: i + 1, Date: int(time.Now().Unix()), From: &models.User{ID: 7, Username: "owner"}, Text: text, Chat: models.Chat{ID: 7, Type: models.ChatTypePrivate}})
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
