package cloudweb

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

func TestWebSocketIntegration(t *testing.T) {
	var mu sync.Mutex
	var outbound []map[string]any
	done := make(chan struct{}, 1)

	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		_, regRaw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var reg wireRegister
		if json.Unmarshal(regRaw, &reg) != nil || reg.Type != "register" {
			return
		}
		_ = conn.WriteJSON(wireRegisterAck{
			Type:         "register_ack",
			OK:           true,
			Capabilities: []string{"text", "reconstruct_reply"},
		})
		msg, _ := json.Marshal(wireInboundMessage{
			Type:       "message",
			MsgID:      "m1",
			SessionKey: "cloud_web:chat1:user1",
			UserID:     "user1",
			Content:    "hello",
			ReplyCtx:   "ctx-1",
		})
		_ = conn.WriteMessage(websocket.TextMessage, msg)
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var m map[string]any
			if json.Unmarshal(raw, &m) == nil {
				mu.Lock()
				outbound = append(outbound, m)
				mu.Unlock()
				if m["type"] == "reply" {
					select {
					case done <- struct{}{}:
					default:
					}
					return
				}
			}
		}
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	p := mustNew(t, map[string]any{
		"token":     "secret",
		"transport": "websocket",
		"ws_url":    wsURL,
	})

	var received sync.WaitGroup
	received.Add(1)
	err := p.Start(func(_ core.Platform, msg *core.Message) {
		if msg.Content != "hello" {
			t.Errorf("content = %q", msg.Content)
		}
		received.Done()
		_ = p.Reply(context.Background(), msg.ReplyCtx, "world")
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = p.Stop() }()

	received.Wait()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for reply")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(outbound) == 0 || outbound[len(outbound)-1]["type"] != "reply" {
		t.Fatalf("outbound = %#v", outbound)
	}
}

func TestAllowFromFilter(t *testing.T) {
	p := mustNew(t, map[string]any{
		"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws",
		"allow_from": "user2",
	})
	p.allowFrom = "user2"

	called := false
	p.handler = func(_ core.Platform, _ *core.Message) { called = true }

	raw, _ := json.Marshal(wireInboundMessage{
		Type: "message", MsgID: "a1", UserID: "user1", Content: "x", ReplyCtx: "r",
	})
	p.handleMessage(raw)
	if called {
		t.Fatal("expected blocked user")
	}
}

func TestWebSocketMalformedQueryFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name  string
		query string
	}{
		{name: "semicolon hides token", query: "token=query-secret;bot=x"},
		{name: "invalid value escape", query: "token=query-secret%zz"},
		{name: "invalid key escape", query: "%zz=query-secret"},
		{name: "valid token with malformed parameter", query: "token=query-secret&name=%zz"},
		{name: "control character in query", query: "token=query-secret\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests := make(chan struct{}, 1)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests <- struct{}{}
				http.Error(w, "unexpected dial", http.StatusBadRequest)
			}))
			defer srv.Close()

			wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/cloud-web/ws?" + tc.query
			tp := newWSTransport(wsURL, "header-secret", "bot", "project")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			err := tp.connectOnce(ctx)
			if err == nil {
				t.Error("malformed query accepted")
			} else {
				if !strings.HasPrefix(err.Error(), "parse ws url: ") {
					t.Errorf("malformed query was not rejected before dialing: %v", err)
				}
				// connectLoop logs this error verbatim, so it must not contain the URL secret.
				if strings.Contains(err.Error(), "query-secret") {
					t.Errorf("connection error leaks query secret: %v", err)
				}
			}
			select {
			case <-requests:
				t.Error("malformed query reached the HTTP handshake")
			default:
			}
		})
	}
}

// TestWebSocketHandshakeDoesNotLeakToken is the regression test for the client
// credential leak: the bot token travels in the Authorization and
// X-Cloud-Web-Token headers only. Neither the transport's own injection nor a
// token left in ws_url by an older config may put it back into the handshake
// URL, where access logs, proxies and browser history would record it. The
// non-sensitive ?bot= parameter must survive the cleanup.
func TestWebSocketHandshakeDoesNotLeakToken(t *testing.T) {
	for _, tc := range []struct {
		name  string
		query string
	}{
		{name: "token injected by client"},
		{name: "token already in ws_url", query: "token=stale-from-config"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			type handshake struct {
				query url.Values
				auth  string
				token string
			}
			handshakes := make(chan handshake, 1)
			upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// A dedicated credential in a header is the only way in.
				if r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("X-Cloud-Web-Token") != "secret" {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				select {
				case handshakes <- handshake{query: r.URL.Query(), auth: r.Header.Get("Authorization"), token: r.Header.Get("X-Cloud-Web-Token")}:
				default:
				}
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer func() { _ = conn.Close() }()
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
				if err := conn.WriteJSON(wireRegisterAck{Type: "register_ack", OK: true}); err != nil {
					return
				}
				for {
					if _, _, err := conn.ReadMessage(); err != nil {
						return
					}
				}
			}))
			defer srv.Close()

			wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/cloud-web/ws?bot=bot-7"
			if tc.query != "" {
				wsURL += "&" + tc.query
			}
			p := mustNew(t, map[string]any{
				"token":     "secret",
				"transport": "websocket",
				"ws_url":    wsURL,
			})
			if err := p.Start(func(core.Platform, *core.Message) {}); err != nil {
				t.Fatalf("Start: %v", err)
			}
			defer func() { _ = p.Stop() }()

			// Send succeeds only after register_ack is consumed, so this waits for
			// the dedicated-token handshake to complete rather than a bare TCP dial.
			deadline := time.Now().Add(5 * time.Second)
			for {
				if err := p.tp.Send(context.Background(), map[string]any{"type": "ping"}); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("websocket never completed the authenticated register handshake")
				}
				time.Sleep(10 * time.Millisecond)
			}

			var hs handshake
			select {
			case hs = <-handshakes:
			case <-time.After(5 * time.Second):
				t.Fatal("timeout waiting for websocket handshake")
			}
			if hs.query.Has("token") {
				t.Fatalf("handshake URL leaks the token: %q", hs.query.Encode())
			}
			if got := hs.query.Get("bot"); got != "bot-7" {
				t.Fatalf("handshake URL dropped bot param: %q", hs.query.Encode())
			}
			if hs.auth != "Bearer secret" {
				t.Fatalf("Authorization = %q, want %q", hs.auth, "Bearer secret")
			}
			if hs.token != "secret" {
				t.Fatalf("X-Cloud-Web-Token = %q, want %q", hs.token, "secret")
			}
		})
	}
}
