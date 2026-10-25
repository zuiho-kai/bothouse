package feishu

import (
	"context"
	"encoding/json"
	"github.com/chenhg5/cc-connect/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	"strconv"
	"testing"
	"time"
)

func TestDMReplayFixture(t *testing.T) {
	anyP, err := New(map[string]any{"app_id": "test", "app_secret": "test", "allow_from": "*"})
	if err != nil {
		t.Fatal(err)
	}
	p := anyP.(*interactivePlatform).Platform
	stubRoutingLookups(t, p)
	received := make(chan *core.Message, 3)
	p.handler = func(_ core.Platform, m *core.Message) { m.ReplyCtx = nil; received <- m }
	var messages []*core.Message
	for i, text := range []string{"跑一个很长的任务", "停", "别做这个，改做X"} {
		id, chat, user, typ, ct, st, now := strconv.Itoa(i+1), "D1", "U1", "text", "p2p", "user", strconv.FormatInt(time.Now().UnixMilli(), 10)
		b, _ := json.Marshal(map[string]string{"text": text})
		content := string(b)
		err = p.onMessage(context.Background(), &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{Sender: &larkim.EventSender{SenderId: &larkim.UserId{OpenId: &user}, SenderType: &st}, Message: &larkim.EventMessage{MessageId: &id, ChatId: &chat, ChatType: &ct, MessageType: &typ, Content: &content, CreateTime: &now}}})
		if err != nil {
			t.Fatal(err)
		}
		select {
		case m := <-received:
			messages = append(messages, m)
		case <-time.After(time.Second):
			t.Fatal("not dispatched")
		}
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
