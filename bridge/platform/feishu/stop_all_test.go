package feishu

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/chenhg5/cc-connect/core"
)

// "/stop all" without a mention reaches the bot; another bot's "/stop all" and
// other unmentioned group messages are still dropped.
func TestOnMessageStopAllWithoutMention(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/open-apis/auth/v3/tenant_access_token/internal" {
			writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "expire": 7200, "tenant_access_token": "tok"})
			return
		}
		writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "data": map[string]any{}})
	}))
	defer srv.Close()

	n := 0
	run := func(senderType, text string) *core.Message {
		n++
		received := make(chan *core.Message, 1)
		p := &Platform{
			platformName: "feishu", domain: srv.URL, appID: "cli_stop", appSecret: "s", botOpenID: "ou_bot",
			dedup:   &core.MessageDedup{},
			client:  lark.NewClient("cli_stop", "s", lark.WithOpenBaseUrl(srv.URL), lark.WithHttpClient(srv.Client())),
			handler: func(_ core.Platform, msg *core.Message) { received <- msg },
		}
		chatType, ct := "group", strconv.FormatInt(time.Now().UnixMilli(), 10)
		content := `{"text":"` + text + `"}`
		ev := &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{
			Sender: &larkim.EventSender{SenderId: &larkim.UserId{OpenId: stringPtr("ou_user")}, SenderType: &senderType},
			Message: &larkim.EventMessage{MessageId: stringPtr("om_" + strconv.Itoa(n)), ChatId: stringPtr("oc_chat"),
				ChatType: &chatType, MessageType: stringPtr("text"), Content: &content, CreateTime: &ct},
		}}
		if err := p.onMessage(context.Background(), ev); err != nil {
			t.Fatalf("onMessage: %v", err)
		}
		select {
		case msg := <-received:
			return msg
		case <-time.After(500 * time.Millisecond):
			return nil
		}
	}
	if got := run("user", "/stop all"); got == nil || got.Content != "/stop all" {
		t.Errorf("user /stop all not dispatched: %+v", got)
	}
	if got := run("app", "/stop all"); got != nil {
		t.Errorf("bot /stop all dispatched: %+v", got)
	}
	if got := run("user", "hello"); got != nil {
		t.Errorf("unmentioned message dispatched: %+v", got)
	}
}
