package cloudweb

import (
	"context"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// 照 platform/discord/lead_return_test.go：副角色干完队长 @ 它派的活，最终回复自动带上 <@队长>。
// 发送记录用 history_test.go 的 recTransport。

func leadPlatform(t *testing.T) (*Platform, *recTransport) {
	t.Helper()
	p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws",
		"group_reply_all": true, "share_session_in_channel": true, "team_lead_bot": "L"})
	tp := &recTransport{}
	p.tp = tp
	return p, tp
}

func inbound(t *testing.T, p *Platform, raw string) *core.Message {
	t.Helper()
	var got *core.Message
	p.handler = func(_ core.Platform, m *core.Message) { got = m }
	p.handleMessage([]byte(raw))
	if got == nil {
		t.Fatal("message not dispatched")
	}
	return got
}

func TestHandleMessage_LeadDispatch(t *testing.T) {
	cases := []struct {
		name, raw, wantLead string
	}{
		{"lead @ sub", `{"type":"message","msg_id":"l1","chat_id":"room-1","user_id":"maomao","user_mention_id":"L","content":"【橘】你来写","chat_type":"group","mentioned":true,"from_bot":true}`, "L"},
		{"lead not @ sub", `{"type":"message","msg_id":"l2","chat_id":"room-1","user_id":"maomao","user_mention_id":"L","content":"【橘】我看看","chat_type":"group","from_bot":true}`, ""},
		{"other bot @ sub", `{"type":"message","msg_id":"l3","chat_id":"room-1","user_id":"jingyu","user_mention_id":"J","content":"【鲸鱼娘】你来","chat_type":"group","mentioned":true,"from_bot":true}`, ""},
		{"person @ sub", `{"type":"message","msg_id":"l4","chat_id":"room-1","user_id":"user","content":"你来","chat_type":"group","mentioned":true}`, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, _ := leadPlatform(t)
			rc, _ := inbound(t, p, c.raw).ReplyCtx.(replyContext)
			if rc.lead != c.wantLead {
				t.Fatalf("lead=%q, want %q", rc.lead, c.wantLead)
			}
		})
	}
}

// 端到端（平台内）：队长派的活，最终回复带 <@L>，同一次派活只带一次；中途的话不带（不半路叫醒队长）。
func TestReplyReturnsToLead(t *testing.T) {
	p, tp := leadPlatform(t)
	rc := inbound(t, p, `{"type":"message","msg_id":"d1","chat_id":"room-1","user_id":"maomao","user_mention_id":"L","content":"【橘】你来写","chat_type":"group","mentioned":true,"from_bot":true}`).ReplyCtx
	ctx := context.Background()
	_ = p.Send(ctx, rc, "我先看看")
	_ = p.Send(ctx, p.MarkFinalReply(rc), "已完成，交橘验收")
	_ = p.Send(ctx, p.MarkFinalReply(rc), "第二段")
	want := []string{"我先看看", "<@L> 已完成，交橘验收", "第二段"}
	if len(tp.sent) != len(want) {
		t.Fatalf("sent %d frames, want %d", len(tp.sent), len(want))
	}
	for i, w := range want {
		if got := tp.sent[i]["content"]; got != w {
			t.Errorf("frame %d content=%q, want %q", i, got, w)
		}
	}
}

// 补发（history.go）和回队长合在同一个 Reply 帧：两个标记都打上时，内容带 <@L>，帧也带 agent=true。
func TestReplyReturnsToLeadKeepsAgentMark(t *testing.T) {
	p, tp := leadPlatform(t)
	rc := inbound(t, p, `{"type":"message","msg_id":"d2","chat_id":"room-1","user_id":"maomao","user_mention_id":"L","content":"【橘】你来写","chat_type":"group","mentioned":true,"from_bot":true}`).ReplyCtx
	_ = p.Send(context.Background(), p.MarkAgentReply(p.MarkFinalReply(rc)), "做完了")
	if len(tp.sent) != 1 {
		t.Fatalf("sent %d frames, want 1", len(tp.sent))
	}
	if got := tp.sent[0]["content"]; got != "<@L> 做完了" {
		t.Errorf("content=%q, want %q", got, "<@L> 做完了")
	}
	if tp.sent[0]["agent"] != true {
		t.Errorf("agent=%v, want true", tp.sent[0]["agent"])
	}
}

func TestReturnToLeadSkips(t *testing.T) {
	p := &Platform{}
	cases := []struct {
		name string
		rc   replyContext
		in   string
	}{
		{"interim post", replyContext{MsgID: "a", lead: "L"}, "我先看看"},
		{"not dispatched by lead", replyContext{MsgID: "b", final: true}, "hi"},
		{"already mentions lead", replyContext{MsgID: "c", final: true, lead: "L"}, "<@L> 好了"},
		{"already mentions lead (nick form)", replyContext{MsgID: "d", final: true, lead: "L"}, "<@!L> 好了"},
		{"empty", replyContext{MsgID: "e", final: true, lead: "L"}, "  "},
	}
	for _, c := range cases {
		if got := p.returnToLead(c.rc, c.in); got != c.in {
			t.Errorf("%s: got %q", c.name, got)
		}
	}
	if got := p.returnToLead(replyContext{MsgID: "c", final: true, lead: "L"}, "补充"); got != "补充" {
		t.Errorf("after explicit @: %q", got)
	}
	rc := replyContext{MsgID: "m2", final: true, lead: "L"}
	if got := p.returnToLead(rc, "新的活"); got != "<@L> 新的活" {
		t.Errorf("new dispatch: %q", got)
	}
}

// 「队友状态」里的频道名（core/team.go 用 msg.ChatName）。
func TestHandleMessage_ChatName(t *testing.T) {
	p, _ := leadPlatform(t)
	m := inbound(t, p, `{"type":"message","msg_id":"n1","chat_id":"room-2","chat_name":"二号","user_id":"user","content":"hi","chat_type":"group","mentioned":true}`)
	if m.ChatName != "二号" {
		t.Fatalf("ChatName=%q", m.ChatName)
	}
}
