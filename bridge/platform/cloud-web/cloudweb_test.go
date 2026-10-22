package cloudweb

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestNew_RequiredFields(t *testing.T) {
	tests := []struct {
		name    string
		opts    map[string]any
		wantErr bool
	}{
		{"missing token", map[string]any{"transport": "websocket", "base_url": "http://x"}, true},
		{"invalid transport", map[string]any{"token": "t", "transport": "mqtt"}, true},
		{"websocket missing url", map[string]any{"token": "t", "transport": "websocket"}, true},
		{"long_poll missing base", map[string]any{"token": "t", "transport": "long_poll"}, true},
		{"gateway missing urls", map[string]any{"token": "t", "transport": "gateway"}, true},
		{"gateway register without public_url", map[string]any{"token": "t", "transport": "gateway", "register_url": "http://x/register"}, true},
		{"websocket ok", map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws"}, false},
		{"long_poll ok", map[string]any{"token": "t", "transport": "long_poll", "base_url": "http://127.0.0.1"}, false},
		{"gateway ok", map[string]any{"token": "t", "transport": "gateway", "base_url": "http://127.0.0.1", "listen": ":0"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := New(tt.opts)
			if tt.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestParseRegisterAck(t *testing.T) {
	raw := []byte(`{"type":"register_ack","ok":true,"capabilities":["text","image"]}`)
	caps, err := parseRegisterAck(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !caps["text"] || !caps["image"] {
		t.Fatalf("caps = %#v", caps)
	}
}

func TestBuildSessionKey(t *testing.T) {
	if got := buildSessionKey("cloud_web", "c1", "u1", false, ""); got != "cloud_web:c1:u1" {
		t.Fatalf("got %q", got)
	}
	if got := buildSessionKey("cloud_web", "c1", "u1", true, ""); got != "cloud_web:c1" {
		t.Fatalf("got %q", got)
	}
	if got := buildSessionKey("cloud_web", "c1", "u1", false, "custom:key"); got != "custom:key" {
		t.Fatalf("got %q", got)
	}
}

func TestDeriveBaseURL(t *testing.T) {
	if got := deriveBaseURL("https://gateway.example.com/cloud-web/v1/register"); got != "https://gateway.example.com" {
		t.Fatalf("got %q", got)
	}
}

// DSH collab 停止房间时给外部 bot 发 message_recall（Issue #8）：帧必须以
// Recalled=true、MessageID=msg_id 交给引擎，引擎据此停掉在跑的一轮或删掉排队消息。
// collab 不带 session_key（引擎按 msg_id 跨会话匹配），多出的 chat_id 应被忽略。
func TestHandleWire_MessageRecallReachesHandler(t *testing.T) {
	p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws"})
	var got *core.Message
	p.handler = func(_ core.Platform, m *core.Message) { got = m }
	p.handleWire([]byte(`{"type":"message_recall","msg_id":"hub-42","chat_id":"room-1"}`))
	if got == nil {
		t.Fatal("recall not dispatched")
	}
	if !got.Recalled || got.MessageID != "hub-42" {
		t.Fatalf("Recalled=%v MessageID=%q, want true hub-42", got.Recalled, got.MessageID)
	}
	got = nil
	p.handleWire([]byte(`{"type":"message_recall","chat_id":"room-1"}`))
	if got != nil {
		t.Fatal("recall without msg_id must be ignored")
	}
}
