package qqbot

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

func TestReadLoop_PreservesSenderIdentity(t *testing.T) {
	upgrader := websocket.Upgrader{}
	serverConn := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		serverConn <- conn
	}))
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	gw := <-serverConn
	got := make(chan *core.Message, 1)
	p := &Platform{wsConn: conn, allowFrom: "stable-id"}
	p.handler = func(_ core.Platform, msg *core.Message) { got <- msg }
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		p.readLoop(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		conn.Close()
		gw.Close()
		server.Close()
		<-done
	})

	for _, group := range []bool{true, false} {
		for i, tc := range []struct {
			name, wantName string
			bot            bool
		}{
			{"小明", "小明", false},
			{"小鱼", "小鱼", true},
			{"", "stable-id", false},
			{"  ", "stable-id", true},
		} {
			t.Run(fmt.Sprintf("group=%t/case=%d", group, i), func(t *testing.T) {
				id := fmt.Sprintf("%t-%d", group, i)
				author := map[string]any{"username": tc.name, "bot": tc.bot}
				payload := map[string]any{"id": id, "content": "你好", "author": author, "timestamp": time.Now().Format(time.RFC3339)}
				event, wantSession, wantChannel := "C2C_MESSAGE_CREATE", "qqbot:stable-id", "stable-id"
				if group {
					author["member_openid"] = "stable-id"
					payload["group_openid"] = "group-1"
					event, wantSession, wantChannel = "GROUP_AT_MESSAGE_CREATE", "qqbot:group-1:stable-id", "group-1"
				} else {
					author["user_openid"] = "stable-id"
				}
				data, err := json.Marshal(payload)
				if err != nil {
					t.Fatal(err)
				}
				if err := gw.WriteJSON(wsPayload{Op: opDispatch, T: event, D: data}); err != nil {
					t.Fatal(err)
				}
				select {
				case msg := <-got:
					if msg.UserName != tc.wantName || msg.FromBot != tc.bot {
						t.Errorf("sender = (%q, bot=%t), want (%q, bot=%t)", msg.UserName, msg.FromBot, tc.wantName, tc.bot)
					}
					if msg.UserID != "stable-id" || msg.SessionKey != wantSession || msg.ChannelKey != wantChannel || msg.MessageID != id {
						t.Errorf("stable routing identity changed: %+v", msg)
					}
					if msg.Mentioned != group || msg.Direct == group {
						t.Errorf("addressing changed: Mentioned=%t Direct=%t", msg.Mentioned, msg.Direct)
					}
					rctx := msg.ReplyCtx.(*replyContext)
					if rctx.userOpenID != "stable-id" || rctx.eventMsgID != id || rctx.sessionKey != wantSession {
						t.Errorf("reply routing changed: %+v", rctx)
					}
				case <-time.After(3 * time.Second):
					t.Fatal("gateway event was not dispatched")
				}
			})
		}
	}
}

func TestSenderNameCannotSatisfyAllowFrom(t *testing.T) {
	for _, event := range []string{"GROUP_AT_MESSAGE_CREATE", "C2C_MESSAGE_CREATE"} {
		t.Run(event, func(t *testing.T) {
			p := &Platform{allowFrom: "allowed-id"}
			p.handler = func(_ core.Platform, _ *core.Message) { t.Error("display name was used for allow_from") }
			p.handleDispatch(event, json.RawMessage(`{"id":"msg","group_openid":"group-1","content":"hello","author":{"username":"allowed-id","member_openid":"other-id","user_openid":"other-id"}}`))
		})
	}
}
