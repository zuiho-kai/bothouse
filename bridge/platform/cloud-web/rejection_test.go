package cloudweb

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

type rejectionLogWriter chan string

func (w rejectionLogWriter) Write(b []byte) (int, error) {
	select {
	case w <- string(b):
	default:
	}
	return len(b), nil
}

func TestServerRejectionOverWebSocketReachesClientLog(t *testing.T) {
	// Source: bounded capture follows the websocket integration test's channel size.
	logs := make(rejectionLogWriter, 10)
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if err := conn.WriteJSON(wireRegisterAck{Type: "register_ack", OK: true}); err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","code":"forbidden","error":"PRIVATE-CONTENT test-only-secret","ref_id":"PRIVATE-REF"}`)); err != nil {
			return
		}
		// Keep the socket alive until the client stops, so a reconnect warning
		// cannot accidentally satisfy the assertion for the rejected message.
		_, _, _ = conn.ReadMessage()
	}))
	defer srv.Close()
	p := mustNew(t, map[string]any{"token": "test-only-secret", "transport": "websocket", "ws_url": "ws" + strings.TrimPrefix(srv.URL, "http"), "cc_project": "alpha", "allow_from": "owner"})
	if err := p.Start(func(core.Platform, *core.Message) { t.Error("rejection was dispatched as a user message") }); err != nil {
		t.Fatal(err)
	}
	defer p.Stop()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case line := <-logs:
			for _, private := range []string{"PRIVATE-CONTENT", "test-only-secret", "PRIVATE-REF"} {
				if strings.Contains(line, private) {
					t.Fatal("server payload leaked into client log")
				}
			}
			if strings.Contains(line, "level=WARN") && strings.Contains(line, "forbidden") && strings.Contains(line, "alpha") {
				return
			}
		case <-deadline:
			t.Fatal("websocket rejection never became visible in the client log")
		}
	}
}

func TestServerRejectionReachesClientLog(t *testing.T) {
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	p := mustNew(t, map[string]any{"token": "test-only-secret", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws", "cc_project": "alpha", "allow_from": "owner"})
	tp := p.tp.(*wsTransport)
	tp.onInbound = p.handleWire
	// Use the actual websocket dispatch boundary, not a direct logger call.
	tp.dispatch([]byte(`{"type":"error","code":"forbidden","error":"PRIVATE-CONTENT test-only-secret","ref_id":"PRIVATE-REF"}`))
	got := buf.String()
	if !strings.Contains(got, "level=WARN") || !strings.Contains(got, "forbidden") || !strings.Contains(got, "alpha") {
		t.Fatalf("rejection is invisible: %s", got)
	}
	for _, private := range []string{"PRIVATE-CONTENT", "test-only-secret", "PRIVATE-REF"} {
		if strings.Contains(got, private) {
			t.Fatal("server payload leaked into logs")
		}
	}
}
