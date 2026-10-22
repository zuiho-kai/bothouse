package cloudweb

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// chat_type "direct" calls the bot: core's built-in busy rules (core/gate_local.go) treat it like
// an @. Groups, a missing chat_type and teammate bots are not Direct.
func TestHandleMessage_DirectChat(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		want      bool
	}{
		{"direct", `{"type":"message","msg_id":"d1","chat_id":"1","user_id":"user","content":"暂停","chat_type":"direct"}`, true},
		{"group", `{"type":"message","msg_id":"d2","chat_id":"1","user_id":"user","content":"暂停","chat_type":"group","mentioned":true}`, false},
		{"no chat_type", `{"type":"message","msg_id":"d3","chat_id":"1","user_id":"user","content":"暂停"}`, false},
		{"bot in direct", `{"type":"message","msg_id":"d4","chat_id":"1","user_id":"longniang","content":"x","chat_type":"direct","from_bot":true}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws"})
			var got *core.Message
			p.handler = func(_ core.Platform, m *core.Message) { got = m }
			p.handleMessage([]byte(tc.raw))
			if got == nil {
				t.Fatal("message not dispatched")
			}
			if got.Direct != tc.want {
				t.Fatalf("Direct = %v, want %v", got.Direct, tc.want)
			}
		})
	}
}
