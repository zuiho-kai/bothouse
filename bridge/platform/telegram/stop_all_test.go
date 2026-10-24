package telegram

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/go-telegram/bot/models"
)

// "/stop all" without a mention reaches the bot; a bot's "/stop all" and other
// unmentioned group messages are still dropped.
func TestHandleMessage_StopAllWithoutMention(t *testing.T) {
	run := func(fromBot bool, text string) *core.Message {
		handled := make(chan *core.Message, 1)
		p := &Platform{token: "token", httpClient: &http.Client{}}
		p.handler = func(_ core.Platform, msg *core.Message) { handled <- msg }
		p.bot = newStubTelegramBot()
		p.selfUser = &models.User{ID: 42, Username: "mybot"}
		p.handleMessage(context.Background(), &models.Message{ID: 10, Date: int(time.Now().Unix()), Text: text,
			Chat: models.Chat{ID: 100, Type: models.ChatTypeSupergroup, Title: "g"},
			From: &models.User{ID: 7, Username: "alice", IsBot: fromBot}})
		select {
		case got := <-handled:
			return got
		case <-time.After(200 * time.Millisecond):
			return nil
		}
	}
	if got := run(false, "/stop all"); got == nil || got.Content != "/stop all" {
		t.Errorf("user /stop all not dispatched: %+v", got)
	}
	if got := run(true, "/stop all"); got != nil {
		t.Errorf("bot /stop all dispatched: %+v", got)
	}
	if got := run(false, "hello"); got != nil {
		t.Errorf("unmentioned message dispatched: %+v", got)
	}
}
