package cloudweb

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// #1662: the DSH gateway sends the raw text and the room's members; who is called and the text each
// bot reads are decided here (was dsh/collab/cloudweb.mjs onNew + hub.replyRoute).
func TestHubMessage_MembersDecideCallAndText(t *testing.T) {
	members := `"members":[{"id":"xiaocheng","name":"小橙"},{"id":"xiaolan","name":"小蓝","mention_id":"77"},{"id":"owner","name":"瑞凤"}]`
	cases := []struct {
		name, raw     string
		dropped       bool
		wantMentioned bool
		wantContent   string
		wantElsewhere bool
	}{
		{"own @ is taken out", `{"type":"message","msg_id":"b1","chat_id":"1","user_id":"owner","user_name":"瑞凤","chat_type":"group","content":"@小橙 派个小活给@小蓝",` + members + `}`,
			false, true, "@小橙(你) 派个小活给<@77>", false},
		{"only @ is a bare call", `{"type":"message","msg_id":"b2","chat_id":"1","user_id":"owner","chat_type":"group","content":"@小橙",` + members + `}`,
			false, true, bareMention, false},
		{"@ of someone else", `{"type":"message","msg_id":"b3","chat_id":"1","user_id":"owner","chat_type":"group","content":"@小蓝 允许",` + members + `}`,
			false, false, "<@77> 允许", true},
		{"@ inside code calls nobody", "{\"type\":\"message\",\"msg_id\":\"b4\",\"chat_id\":\"1\",\"user_id\":\"owner\",\"chat_type\":\"group\",\"content\":\"看 `@小橙` 这个词\"," + members + `}`,
			false, false, "看 `@小橙` 这个词", false},
		{"name call", `{"type":"message","msg_id":"b5","chat_id":"1","user_id":"owner","chat_type":"group","content":"小橙，看下",` + members + `}`,
			false, true, "小橙，看下", false},
		{"reply to another bot", `{"type":"message","msg_id":"b6","chat_id":"1","user_id":"owner","chat_type":"group","content":"好的","reply_to_id":"9","reply_to_role_id":"xiaolan",` + members + `}`,
			true, false, "", false},
		{"reply to this bot", `{"type":"message","msg_id":"b7","chat_id":"1","user_id":"owner","chat_type":"group","content":"好的","quote":"> 原话\n","reply_to_id":"9","reply_to_role_id":"xiaocheng",` + members + `}`,
			false, true, "> 原话\n好的", false},
		{"reply to a deleted message", `{"type":"message","msg_id":"b8","chat_id":"1","user_id":"owner","chat_type":"group","content":"好的","reply_to_id":"9","reply_to_gone":true,` + members + `}`,
			true, false, "", false},
		{"teammate calls this bot", `{"type":"message","msg_id":"b9","chat_id":"1","user_id":"xiaolan","user_name":"小蓝","chat_type":"group","from_bot":true,"content":"@小橙 现在是 18:30",` + members + `}`,
			false, true, "【小蓝】现在是 18:30", false},
		{"teammate only @-s this bot", `{"type":"message","msg_id":"b10","chat_id":"1","user_id":"xiaolan","user_name":"小蓝","chat_type":"group","from_bot":true,"content":"@小橙",` + members + `}`,
			true, false, "", false},
		{"calls no one: the room's default reply member answers", `{"type":"message","msg_id":"b12","chat_id":"1","user_id":"owner","chat_type":"group","content":"在吗","default_reply":"xiaocheng",` + members + `}`,
			false, true, "在吗", false},
		{"calls no one: another member is the default reply", `{"type":"message","msg_id":"b13","chat_id":"1","user_id":"owner","chat_type":"group","content":"在吗","default_reply":"xiaolan",` + members + `}`,
			false, false, "在吗", true},
		{"@ of someone else beats the default reply", `{"type":"message","msg_id":"b14","chat_id":"1","user_id":"owner","chat_type":"group","content":"@小蓝 看下","default_reply":"xiaocheng",` + members + `}`,
			false, false, "<@77> 看下", true},
		{"a name call of someone else beats the default reply", `{"type":"message","msg_id":"b15","chat_id":"1","user_id":"owner","chat_type":"group","content":"小蓝，看下","default_reply":"xiaocheng",` + members + `}`,
			false, false, "小蓝，看下", false},
		{"a teammate's text is not taken by the default reply", `{"type":"message","msg_id":"b16","chat_id":"1","user_id":"xiaolan","user_name":"小蓝","chat_type":"group","from_bot":true,"content":"做完了","default_reply":"xiaocheng",` + members + `}`,
			false, false, "【小蓝】做完了", false},
		{"not in the room", `{"type":"message","msg_id":"b11","chat_id":"1","user_id":"owner","chat_type":"group","content":"@小橙 hi","members":[{"id":"xiaolan","name":"小蓝"}]}`,
			true, false, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws?bot=xiaocheng&name=小橙",
				"group_reply_all": true, "share_session_in_channel": true})
			var got *core.Message
			p.handler = func(_ core.Platform, m *core.Message) { got = m }
			p.handleMessage([]byte(tc.raw))
			if tc.dropped {
				if got != nil {
					t.Fatalf("dispatched %q, want dropped", got.Content)
				}
				return
			}
			if got == nil {
				t.Fatal("message not dispatched")
			}
			if got.Mentioned != tc.wantMentioned || got.Content != tc.wantContent || got.AddressedElsewhere != tc.wantElsewhere {
				t.Fatalf("Mentioned=%v Content=%q Elsewhere=%v, want %v %q %v", got.Mentioned, got.Content, got.AddressedElsewhere, tc.wantMentioned, tc.wantContent, tc.wantElsewhere)
			}
		})
	}
}

// What a bot posts is shown with names: <@77> and @xiaolan become @小蓝.
func TestHubMessage_RepliesShowNames(t *testing.T) {
	p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws?bot=xiaocheng"})
	p.handleRoster([]byte(`{"type":"roster","members":[{"id":"xiaolan","name":"小蓝","mention_id":"77"}]}`))
	frame := map[string]any{"type": "reply", "content": "<@77> 和 @xiaolan 看下"}
	p.displayMentions(frame)
	if frame["content"] != "@小蓝 和 @小蓝 看下" {
		t.Fatalf("content = %q", frame["content"])
	}
}
