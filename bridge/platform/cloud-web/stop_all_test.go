package cloudweb

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// "/stop all" without a mention reaches the bot; a teammate bot's "/stop all"
// and other unmentioned group messages are still dropped.
func TestHandleMessage_StopAllWithoutMention(t *testing.T) {
	cases := []struct {
		name, raw string
		want      bool
	}{
		{"user /stop all", `{"type":"message","msg_id":"s1","chat_id":"1","user_id":"user","content":"/stop all","chat_type":"group","mentioned":false}`, true},
		{"bot /stop all", `{"type":"message","msg_id":"s2","chat_id":"1","user_id":"longniang","content":"/stop all","chat_type":"group","from_bot":true}`, false},
		{"user no mention", `{"type":"message","msg_id":"s3","chat_id":"1","user_id":"user","content":"hello","chat_type":"group"}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws",
				"group_reply_all": false})
			var got *core.Message
			p.handler = func(_ core.Platform, m *core.Message) { got = m }
			p.handleMessage([]byte(tc.raw))
			if (got != nil) != tc.want {
				t.Fatalf("dispatched=%v, want %v (%+v)", got != nil, tc.want, got)
			}
		})
	}
}
