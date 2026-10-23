package cloudweb

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// 网关给的 mentioned / from_bot 要进 core.Message：gate 靠 Mentioned 判断谁回，
// 靠 FromBot 把队友没 @ 自己的话只当上下文（core/gate.go applyGate）。
func TestHandleMessage_CarriesMentionedAndFromBot(t *testing.T) {
	cases := []struct {
		name          string
		raw           string
		wantMentioned bool
		wantFromBot   bool
	}{
		{"user mentions bot", `{"type":"message","msg_id":"a1","chat_id":"1","user_id":"user","content":"hi","chat_type":"group","mentioned":true}`, true, false},
		{"user no mention", `{"type":"message","msg_id":"a2","chat_id":"1","user_id":"user","content":"hi","chat_type":"group","mentioned":false}`, false, false},
		{"mentioned omitted", `{"type":"message","msg_id":"a3","chat_id":"1","user_id":"user","content":"hi","chat_type":"group"}`, false, false},
		{"teammate bot mentions", `{"type":"message","msg_id":"a4","chat_id":"1","user_id":"longniang","content":"【龙娘】hi","chat_type":"group","mentioned":true,"from_bot":true}`, true, true},
		{"teammate bot context", `{"type":"message","msg_id":"a5","chat_id":"1","user_id":"longniang","content":"【龙娘】hi","chat_type":"group","from_bot":true}`, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws",
				"group_reply_all": true, "share_session_in_channel": true})
			var got *core.Message
			p.handler = func(_ core.Platform, m *core.Message) { got = m }
			p.handleMessage([]byte(tc.raw))
			if got == nil {
				t.Fatal("message not dispatched")
			}
			if got.Mentioned != tc.wantMentioned || got.FromBot != tc.wantFromBot {
				t.Fatalf("Mentioned=%v FromBot=%v, want %v %v", got.Mentioned, got.FromBot, tc.wantMentioned, tc.wantFromBot)
			}
		})
	}
}

func TestHandleMessage_TracksDSHPrimaryRole(t *testing.T) {
	p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws?bot=ju", "group_reply_all": true})
	p.handler = func(_ core.Platform, _ *core.Message) {}
	p.handleMessage([]byte(`{"type":"message","msg_id":"lead-1","chat_id":"1","user_id":"user","content":"hello","chat_type":"group","lead_id":"ju"}`))
	if lead, known := p.TeamLeadState(); !known || !lead {
		t.Fatalf("lead state = (%v, %v), want (true, true)", lead, known)
	}
	p.handleMessage([]byte(`{"type":"message","msg_id":"lead-2","chat_id":"1","user_id":"user","content":"hello","chat_type":"group","lead_id":"ds"}`))
	if lead, known := p.TeamLeadState(); !known || lead {
		t.Fatalf("lead state = (%v, %v), want (false, true)", lead, known)
	}
}

// 队友 bot 不受 allow_from 限制（和 Discord 的 allow_bots 一样由网关担保），allow_from 只管人。
func TestHandleMessage_FromBotBypassesAllowFrom(t *testing.T) {
	p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws",
		"group_reply_all": true, "allow_from": "user"})
	var got []*core.Message
	p.handler = func(_ core.Platform, m *core.Message) { got = append(got, m) }
	p.handleMessage([]byte(`{"type":"message","msg_id":"b1","chat_id":"1","user_id":"longniang","content":"x","chat_type":"group","from_bot":true}`))
	p.handleMessage([]byte(`{"type":"message","msg_id":"b2","chat_id":"1","user_id":"stranger","content":"x","chat_type":"group"}`))
	if len(got) != 1 || got[0].UserID != "longniang" {
		t.Fatalf("got %d messages, want only the bot one", len(got))
	}
}
