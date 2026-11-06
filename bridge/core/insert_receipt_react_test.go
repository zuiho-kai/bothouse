package core

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The insert acknowledgement becomes a reaction on the person's own message when
// the platform can place one (user 2026-11-05「点表情可以考虑加上 回头可以加」). If
// the reaction cannot be placed, the old receipt rule is what the chat gets — and
// on QQ that rule is silence, so a failing reaction must never turn into a text
// line the person had asked not to see.

// reactingPlatform is QQ as it now behaves: it can put a reaction in group chats,
// fails in private ones, and keeps deliberate silence in both.
type reactingPlatform struct {
	stubPlatformEngine
	reactions []any
	fail      bool
}

func (p *reactingPlatform) QuietSystemNotices(replyCtx any) bool { return replyCtx == "group" }
func (p *reactingPlatform) QuietInsertReceipt(replyCtx any) bool { return true }

func (p *reactingPlatform) ReactInsertReceipt(replyCtx any) error {
	if p.fail || replyCtx != "group" {
		return fmt.Errorf("qq: reaction: NapCat cannot react here")
	}
	p.reactions = append(p.reactions, replyCtx)
	return nil
}

// plainReactingPlatform has no quieter at all: a failed reaction must fall back to
// the text receipt, because nothing else was suppressing it before.
type plainReactingPlatform struct {
	stubPlatformEngine
	fail bool
}

func (p *plainReactingPlatform) ReactInsertReceipt(replyCtx any) error {
	if p.fail {
		return fmt.Errorf("qq: reaction: upstream refused")
	}
	return nil
}

func TestInsertReceiptReactedInGroupWithoutText(t *testing.T) {
	p := &reactingPlatform{stubPlatformEngine: stubPlatformEngine{n: "qq"}}
	e, running, s := gateEngine(t, p, LangChinese)
	msg := &Message{SessionKey: "qq:g:1", MessageID: "1", UserID: "u1", UserName: "u", Content: "补充一句", ReplyCtx: "group", GroupChat: true, Mentioned: true}
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a busy group message that calls the bot is inserted")
	}
	if got := injectedText(t, running); !strings.Contains(got, "补充一句") {
		t.Fatalf("mid-turn input = %q, want the message", got)
	}
	if len(p.reactions) != 1 || p.reactions[0] != "group" {
		t.Fatalf("reactions = %v, want one on the inserted message", p.reactions)
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got a text receipt next to the reaction: %q", sent)
	}
}

func TestInsertReceiptReactionFailureStaysSilentInQuietChat(t *testing.T) {
	p := &reactingPlatform{stubPlatformEngine: stubPlatformEngine{n: "qq"}, fail: true}
	e, running, s := gateEngine(t, p, LangChinese)
	msg := &Message{SessionKey: "qq:g:1", MessageID: "1", UserID: "u1", UserName: "u", Content: "补充一句", ReplyCtx: "private", Direct: true, Mentioned: true}
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a busy private message is inserted")
	}
	if got := injectedText(t, running); !strings.Contains(got, "补充一句") {
		t.Fatalf("mid-turn input = %q, want the message", got)
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("private chat got the receipt back after the reaction failed: %q", sent)
	}
}

func TestInsertReceiptReactionFailureKeepsTextWhereItWas(t *testing.T) {
	p := &plainReactingPlatform{stubPlatformEngine: stubPlatformEngine{n: "qq"}, fail: true}
	e, running, s := gateEngine(t, p, LangChinese)
	msg := &Message{SessionKey: "qq:g:1", MessageID: "1", UserID: "u1", UserName: "u", Content: "补充一句", ReplyCtx: "group", GroupChat: true, Mentioned: true}
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a busy group message is inserted")
	}
	if got := injectedText(t, running); !strings.Contains(got, "补充一句") {
		t.Fatalf("mid-turn input = %q, want the message", got)
	}
	sent := p.getSent()
	if len(sent) != 1 || sent[0] != "↪ 已插入" {
		t.Fatalf("sent = %q, want the text receipt on a platform whose fallback is text", sent)
	}
}

// The gate service's "reply" decision reaches the same helper, so the reaction must
// replace the line there too.
func TestGateReactionReplacesInsertReceipt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"action":"reply"}`)
	}))
	defer srv.Close()
	p := &reactingPlatform{stubPlatformEngine: stubPlatformEngine{n: "qq"}}
	e, running, s := gateEngine(t, p, LangChinese)
	e.SetGate(srv.URL+"/decide", 1000, "reply")
	msg := &Message{SessionKey: "qq:g:1", MessageID: "1", UserID: "u1", UserName: "u", Content: "补充一句", ReplyCtx: "group", GroupChat: true, Mentioned: true}
	e.gate.mu.Lock()
	e.gate.released[msg] = true // skip the burst window
	e.gate.mu.Unlock()
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a busy group message answered \"reply\" is inserted")
	}
	if got := injectedText(t, running); !strings.Contains(got, "补充一句") {
		t.Fatalf("mid-turn input = %q, want the message", got)
	}
	if len(p.reactions) != 1 {
		t.Fatalf("reactions = %v, want one", p.reactions)
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("text receipt went out next to the reaction: %q", sent)
	}
}
