package qq

import (
	"context"
	"errors"
	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTaskTextOneBotReceipt(t *testing.T) {
	u := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := u.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for {
			var req map[string]any
			if c.ReadJSON(&req) != nil {
				return
			}
			data := map[string]any{"user_id": 999, "nickname": "fixture"}
			if req["action"] == "send_group_msg" {
				data = map[string]any{"message_id": 123}
			}
			_ = c.WriteJSON(map[string]any{"echo": req["echo"], "status": "ok", "retcode": 0, "data": data})
		}
	}))
	defer srv.Close()
	p := &Platform{wsURL: "ws" + strings.TrimPrefix(srv.URL, "http")}
	if err := p.Start(func(core.Platform, *core.Message) {}); err != nil {
		t.Fatal(err)
	}
	defer p.Stop()
	id, err := p.SendTaskTextPart(context.Background(), "qq:g:12345", "key", "body")
	if err != nil || id != "123" {
		t.Fatal(id, err)
	}
	q := &Platform{}
	if _, err := q.SendTaskTextPart(context.Background(), "qq:g:12345", "key", "body"); !errors.Is(err, core.ErrTaskTextNotAccepted) {
		t.Fatal(err)
	}
}
