package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type quoteSendPlatform struct {
	stubPlatformEngine
	quoteID string
	text    string
	at      []string
	all     bool
}

func TestHandleSendNativeQuoteRejectsInvalidTargets(t *testing.T) {
	for _, payload := range []string{
		`{"message":"text","reply_to_message_id":"103"}`,
		`{"session_key":"test:chat","reply_to_message_id":"103"}`,
		`{"session_key":"test:chat","message":"text","cwd":"/elsewhere","reply_to_message_id":"103"}`,
		`{"session_key":"test:chat","message":"text","dm":true,"reply_to_message_id":"103"}`,
	} {
		p := &quoteSendPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
		e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
		api := &APIServer{engines: map[string]*Engine{"test": e}}
		rec := httptest.NewRecorder()
		api.handleSend(rec, httptest.NewRequest(http.MethodPost, "/send", strings.NewReader(payload)))
		if rec.Code != http.StatusBadRequest || p.quoteID != "" || len(p.getSent()) != 0 {
			t.Fatalf("payload=%s status=%d body=%s native=%q", payload, rec.Code, rec.Body.String(), p.quoteID)
		}
	}
}

func TestHandleSendNativeQuoteUnsupportedDoesNotDowngrade(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.interactiveStates["test:chat"] = &interactiveState{platform: p, replyCtx: "ctx"}
	api := &APIServer{engines: map[string]*Engine{"test": e}}
	rec := httptest.NewRecorder()
	api.handleSend(rec, httptest.NewRequest(http.MethodPost, "/send", strings.NewReader(`{"session_key":"test:chat","message":"text","reply_to_message_id":"103"}`)))
	if rec.Code == http.StatusOK || len(p.getSent()) != 0 {
		t.Fatalf("unsupported reply silently sent plain text: status=%d sent=%v", rec.Code, p.getSent())
	}
}

func TestNativeQuoteContextReachesAgent(t *testing.T) {
	for _, native := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary platform", true: "native reply platform"}[native], func(t *testing.T) {
			as := &inputTestSession{events: make(chan Event, 1), prompts: make(chan string, 1), id: "quote-session"}
			a := &inputTestAgent{session: as}
			var p Platform = &stubPlatformEngine{n: "test"}
			if native {
				p = &quoteSendPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
			}
			e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
			t.Cleanup(func() { e.cancel(); _ = e.Stop() })
			e.ReceiveMessage(p, &Message{SessionKey: "test:chat", Platform: "test", MessageID: "104", UserID: "2001", UserName: "提问者", Content: "看看这条", ExtraContent: "[引用消息]\n原作者：重启前原文", Reference: &MessageReference{ID: "103", Author: "原作者", Text: "重启前原文"}, Mentioned: true, ReplyCtx: "ctx"})
			prompt := inputPrompt(t, a)
			inputDone(a, "NO_REPLY")
			if !strings.Contains(prompt, "原作者：重启前原文") || !strings.Contains(prompt, "看看这条") {
				t.Fatalf("quoted context missing from actual AgentSession.Send: %q", prompt)
			}
			if strings.Contains(prompt, "[Message IDs: current=104 reply_to=103]") != native {
				t.Fatalf("message ID capability marker native=%v prompt=%q", native, prompt)
			}
			if strings.Contains(prompt, "bothouse send --reply-to") != native {
				t.Fatalf("native reply tool must be discoverable without backend system prompt support: native=%v prompt=%q", native, prompt)
			}
		})
	}
	if !strings.Contains(AgentSystemPrompt(), "bothouse send --reply-to <message-id>") {
		t.Fatal("native send tool is not discoverable in shared agent instructions")
	}
}

func (p *quoteSendPlatform) ReplyToMessage(_ context.Context, _ any, text, id string, at []string, all bool) error {
	p.quoteID, p.text, p.at, p.all = id, text, at, all
	return nil
}

func TestHandleSendNativeQuote(t *testing.T) {
	p := &quoteSendPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.interactiveStates["test:chat"] = &interactiveState{platform: p, replyCtx: "ctx"}
	api := &APIServer{engines: map[string]*Engine{"test": e}}
	req := httptest.NewRequest(http.MethodPost, "/send", strings.NewReader(`{"project":"test","session_key":"test:chat","message":"quoted text","reply_to_message_id":"103","at_users":["2001"]}`))
	rec := httptest.NewRecorder()
	api.handleSend(rec, req)
	if rec.Code != http.StatusOK || p.quoteID != "103" || p.text != "quoted text" || len(p.at) != 1 {
		t.Fatalf("status=%d body=%s native quote=%q text=%q at=%v", rec.Code, rec.Body.String(), p.quoteID, p.text, p.at)
	}
}
