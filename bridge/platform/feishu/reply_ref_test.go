package feishu

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/chenhg5/cc-connect/core"
)

// A reply (parent_id) reaches core as Message.Reference.ID, so core can find the work the
// replied-to message belongs to (core/reply_task.go).
func TestOnMessageReplyFillsReferenceID(t *testing.T) {
	const appID, appSecret = "cli_reply_ref", "secret-reply-ref"
	got := make(chan *core.Message, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/open-apis/auth/v3/tenant_access_token/internal":
			writeJSON(t, w, map[string]any{"code": 0, "expire": 7200, "tenant_access_token": "t"})
		case r.URL.Path == "/open-apis/im/v1/messages/om_parent":
			writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "data": map[string]any{"items": []map[string]any{{
				"msg_type": "text",
				"sender":   map[string]any{"id": "ou_bot", "sender_type": "app"},
				"body":     map[string]any{"content": `{"text":"任务卡 t-1"}`},
			}}}})
		default:
			writeJSON(t, w, map[string]any{"code": 0, "msg": "success"})
		}
	}))
	defer srv.Close()

	p := &Platform{
		platformName: "feishu",
		domain:       srv.URL,
		appID:        appID,
		appSecret:    appSecret,
		botOpenID:    "ou_bot",
		dedup:        &core.MessageDedup{},
		client:       lark.NewClient(appID, appSecret, lark.WithOpenBaseUrl(srv.URL), lark.WithHttpClient(srv.Client())),
		handler:      func(_ core.Platform, msg *core.Message) { got <- msg },
	}
	chatType, senderType, msgType := "p2p", "user", "text"
	content := `{"text":"顺便把注册也看看"}`
	createTime := strconv.FormatInt(time.Now().Add(time.Second).UnixMilli(), 10)
	err := p.onMessage(context.Background(), &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{
		Sender: &larkim.EventSender{SenderId: &larkim.UserId{OpenId: strPtr("ou_user")}, SenderType: &senderType},
		Message: &larkim.EventMessage{
			MessageId: strPtr("om_child"), ParentId: strPtr("om_parent"), ChatId: strPtr("oc_p2p"),
			ChatType: &chatType, MessageType: &msgType, Content: &content, CreateTime: &createTime,
		},
	}})
	if err != nil {
		t.Fatalf("onMessage() error = %v", err)
	}
	select {
	case msg := <-got:
		if msg.Reference == nil || msg.Reference.ID != "om_parent" {
			t.Fatalf("Reference = %+v, want ID om_parent", msg.Reference)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for dispatched message")
	}
}

// RecordSentMessages (core.SentMessageRecorder) gets the message_id of every message posted
// with the context, both as a new message and as a reply.
func TestRecordSentMessagesGetsMessageID(t *testing.T) {
	const appID, appSecret = "cli_record_sent", "secret-record-sent"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/open-apis/auth/v3/tenant_access_token/internal":
			writeJSON(t, w, map[string]any{"code": 0, "expire": 7200, "tenant_access_token": "t"})
		case r.URL.Path == "/open-apis/im/v1/messages" && r.Method == http.MethodPost:
			writeJSON(t, w, map[string]any{"code": 0, "data": map[string]any{"message_id": "om_created"}})
		case strings.HasSuffix(r.URL.Path, "/reply") && r.Method == http.MethodPost:
			writeJSON(t, w, map[string]any{"code": 0, "data": map[string]any{"message_id": "om_replied"}})
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	p := &Platform{
		platformName: "feishu",
		domain:       srv.URL,
		appID:        appID,
		appSecret:    appSecret,
		client:       lark.NewClient(appID, appSecret, lark.WithOpenBaseUrl(srv.URL), lark.WithHttpClient(srv.Client())),
	}
	var mu sync.Mutex
	var ids []string
	record := func(id string) { mu.Lock(); ids = append(ids, id); mu.Unlock() }

	newCtx := p.RecordSentMessages(replyContext{chatID: "oc_chat"}, record)
	if err := p.Send(context.Background(), newCtx, "新消息"); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	replyCtx := p.RecordSentMessages(replyContext{chatID: "oc_chat", messageID: "om_trigger"}, record)
	if err := p.Reply(context.Background(), replyCtx, "回复"); err != nil {
		t.Fatalf("Reply() error = %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if strings.Join(ids, ",") != "om_created,om_replied" {
		t.Fatalf("recorded ids = %v, want [om_created om_replied]", ids)
	}
}
