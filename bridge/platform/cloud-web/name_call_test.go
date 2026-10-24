package cloudweb

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// 行首喊名字（没写 @）和 Discord 一样算点名（platform/discord #248）：网关没标 mentioned 时，
// 平台自己认出「龙娘，…」，并在算交回对象之前认出，队长喊名派的活交回时能 @ 回队长。

func namedPlatform(t *testing.T, wsURL, lead string) *Platform {
	t.Helper()
	opts := map[string]any{"token": "t", "transport": "websocket", "ws_url": wsURL,
		"group_reply_all": true, "share_session_in_channel": true}
	if lead != "" {
		opts["team_lead_bot"] = lead
	}
	return mustNew(t, opts)
}

func TestHandleMessage_LeadingNameCall(t *testing.T) {
	cases := []struct {
		name, wsURL, lead, raw string
		wantMentioned          bool
		wantLead               string
	}{
		// ① 用户行首喊队友名派活 → 队友被点名
		{"person calls sub", "ws://127.0.0.1:1/ws?bot=longniang&name=龙娘", "L",
			`{"type":"message","msg_id":"n1","chat_id":"room-1","user_id":"user","content":"龙娘，帮我看看这个","chat_type":"group"}`, true, ""},
		// 队长行首喊名派活 → 队友被点名，且记下交回对象（#248 的根因）
		{"lead calls sub", "ws://127.0.0.1:1/ws?bot=longniang&name=龙娘", "L",
			`{"type":"message","msg_id":"n2","chat_id":"room-1","user_id":"maomao","user_mention_id":"L","content":"【橘】龙娘，接手这件事","chat_type":"group","from_bot":true}`, true, "L"},
		// ② 队友交回时行首喊主角色名 → 主角色被点名
		{"sub calls lead", "ws://127.0.0.1:1/ws?bot=maomao&name=橘", "",
			`{"type":"message","msg_id":"n3","chat_id":"room-1","user_id":"longniang","user_mention_id":"G","content":"【龙娘】橘，做完了","chat_type":"group","from_bot":true}`, true, ""},
		// 显示名带 ASCII 前缀时短名也算（botNames：「Claude橘」→「橘」）
		{"short name", "ws://127.0.0.1:1/ws?bot=maomao&name=Claude橘", "",
			`{"type":"message","msg_id":"n4","chat_id":"room-1","user_id":"longniang","content":"【龙娘】橘 PR 开好了","chat_type":"group","from_bot":true}`, true, ""},
		// 句中提到不算
		{"mid-sentence", "ws://127.0.0.1:1/ws?bot=longniang&name=龙娘", "L",
			`{"type":"message","msg_id":"n5","chat_id":"room-1","user_id":"maomao","user_mention_id":"L","content":"【橘】这个龙娘之前写过","chat_type":"group","from_bot":true}`, false, ""},
		// 没有 name 就退回 bot=
		{"bot id as name", "ws://127.0.0.1:1/ws?bot=longniang", "L",
			`{"type":"message","msg_id":"n6","chat_id":"room-1","user_id":"user","content":"longniang 看一下","chat_type":"group"}`, true, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := namedPlatform(t, c.wsURL, c.lead)
			got := inbound(t, p, c.raw)
			if got.Mentioned != c.wantMentioned {
				t.Fatalf("Mentioned=%v, want %v", got.Mentioned, c.wantMentioned)
			}
			rc, _ := got.ReplyCtx.(replyContext)
			if rc.lead != c.wantLead {
				t.Fatalf("lead=%q, want %q", rc.lead, c.wantLead)
			}
		})
	}
}

// 不开 group_reply_all 时，行首喊名也要过群聊的「要 @」门槛（同 Discord：喊名算 @）。
func TestHandleMessage_LeadingNameCallPassesMentionFilter(t *testing.T) {
	p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws?bot=longniang&name=龙娘"})
	var got *core.Message
	p.handler = func(_ core.Platform, m *core.Message) { got = m }
	p.handleMessage([]byte(`{"type":"message","msg_id":"f1","chat_id":"room-1","user_id":"user","content":"龙娘，帮我看看","chat_type":"group"}`))
	if got == nil || !got.Mentioned {
		t.Fatalf("leading-name call dropped: %+v", got)
	}
}

// 队长喊名派的活：最终回复自动带 <@队长>，网关据此唤起队长（端到端，平台内）。
func TestLeadingNameDispatchReturnsToLead(t *testing.T) {
	p := namedPlatform(t, "ws://127.0.0.1:1/ws?bot=longniang&name=龙娘", "L")
	tp := &recTransport{}
	p.tp = tp
	rc := inbound(t, p, `{"type":"message","msg_id":"r1","chat_id":"room-1","user_id":"maomao","user_mention_id":"L","content":"【橘】龙娘，接手这件事","chat_type":"group","from_bot":true}`).ReplyCtx
	_ = p.Send(t.Context(), p.MarkFinalReply(rc), "做完了")
	if len(tp.sent) != 1 {
		t.Fatalf("sent %d frames, want 1", len(tp.sent))
	}
	if c := tp.sent[0]["content"]; c != "<@L> 做完了" {
		t.Fatalf("final reply = %q, want it to @ the lead", c)
	}
}
