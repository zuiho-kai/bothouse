package telegram

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/go-telegram/bot/models"
)

// Who a message calls, for core's built-in busy rules (core/gate_local.go): a private chat is
// Direct; in a group an @bot or a reply to the bot is Mentioned, other group chatter is not.
func TestHandleMessage_MarksCalled(t *testing.T) {
	group := models.Chat{ID: 100, Type: models.ChatTypeSupergroup, Title: "g"}
	for _, tc := range []struct {
		name                      string
		replyAll                  bool
		msg                       models.Message
		wantMentioned, wantDirect bool
	}{
		{"private", false, models.Message{Text: "暂停", Chat: models.Chat{ID: 7, Type: models.ChatTypePrivate}}, false, true},
		{"group @bot", false, models.Message{Text: "@mybot 暂停", Chat: group,
			Entities: []models.MessageEntity{{Type: models.MessageEntityTypeMention, Offset: 0, Length: 6}}}, true, false},
		{"group reply to bot", false, models.Message{Text: "暂停", Chat: group,
			ReplyToMessage: &models.Message{ID: 9, Text: "我在跑", From: &models.User{ID: 42, Username: "mybot"}}}, true, false},
		{"group reply_all, not called", true, models.Message{Text: "暂停", Chat: group}, false, false},
		{"group @other bot", true, models.Message{Text: "@otherbot 暂停", Chat: group,
			Entities: []models.MessageEntity{{Type: models.MessageEntityTypeMention, Offset: 0, Length: 9}}}, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handled := make(chan *core.Message, 1)
			p := &Platform{token: "token", httpClient: &http.Client{}, groupReplyAll: tc.replyAll}
			p.handler = func(_ core.Platform, msg *core.Message) { handled <- msg }
			p.bot = newStubTelegramBot()
			p.selfUser = &models.User{ID: 42, Username: "mybot"}
			m := tc.msg
			m.ID, m.Date, m.From = 10, int(time.Now().Unix()), &models.User{ID: 7, Username: "alice"}
			p.handleMessage(context.Background(), &m)
			select {
			case got := <-handled:
				if got.Mentioned != tc.wantMentioned || got.Direct != tc.wantDirect {
					t.Fatalf("Mentioned=%v Direct=%v, want %v %v", got.Mentioned, got.Direct, tc.wantMentioned, tc.wantDirect)
				}
			case <-time.After(time.Second):
				t.Fatal("message not handled")
			}
		})
	}
}
