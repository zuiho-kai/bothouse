package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// maomao fork (user 2026-10-20 on the self-hosted platform, room 2 messages 278-282): the user's
// "@橘 … 请 @龙娘 帮你算 17×23" started a turn for 龙娘 directly; 橘's dispatch "@龙娘 帮我算一下"
// then arrived mid-turn and was injected ("↪ 已插入"). 龙娘's final answer went out under the
// user's trigger only, so it carried no <@橘> and 橘 never picked it up. A message injected into a
// running turn is part of that turn's input: what its reply context says about the trigger (here,
// "the lead dispatched this") must reach the turn's final answer, as a burst merge does on Discord.

// injectTurnSession answers only after its second input arrives: the first Send starts the turn,
// the second is the mid-turn injection.
type injectTurnSession struct {
	events chan Event
	mu     sync.Mutex
	sends  int
}

func (s *injectTurnSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.sends++
	n := s.sends
	s.mu.Unlock()
	if n == 2 {
		go func() { s.events <- Event{Type: EventResult, Content: "391", Done: true} }()
	}
	return nil
}
func (s *injectTurnSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *injectTurnSession) Events() <-chan Event                             { return s.events }
func (s *injectTurnSession) CurrentSessionID() string                         { return "inject-1" }
func (s *injectTurnSession) Alive() bool                                      { return true }
func (s *injectTurnSession) Close() error                                     { return nil }

type injectTurnAgent struct{ s *injectTurnSession }

func (a *injectTurnAgent) Name() string { return "codex" }
func (a *injectTurnAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.s, nil
}
func (a *injectTurnAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *injectTurnAgent) Stop() error                                              { return nil }
func (a *injectTurnAgent) SupportsMidTurnInput() bool                               { return true }

// leadCtx is a platform reply context that records whether the lead dispatched the turn.
type leadCtx struct {
	id    string
	lead  bool
	final bool
}

type leadSend struct {
	ctx     leadCtx
	content string
}

type leadPlatform struct {
	mu   sync.Mutex
	sent []leadSend
}

func (p *leadPlatform) Name() string               { return "test" }
func (p *leadPlatform) Start(MessageHandler) error { return nil }
func (p *leadPlatform) Stop() error                { return nil }
func (p *leadPlatform) Reply(_ context.Context, rc any, content string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	c, _ := rc.(leadCtx)
	p.sent = append(p.sent, leadSend{c, content})
	return nil
}
func (p *leadPlatform) Send(ctx context.Context, rc any, content string) error {
	return p.Reply(ctx, rc, content)
}
func (p *leadPlatform) MarkFinalReply(rc any) any {
	c, _ := rc.(leadCtx)
	c.final = true
	return c
}
func (p *leadPlatform) MergeInjectedReply(turn, injected any) any {
	t, _ := turn.(leadCtx)
	if in, ok := injected.(leadCtx); ok && in.lead {
		t.lead = true
	}
	return t
}
func (p *leadPlatform) final() (leadSend, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, s := range p.sent {
		if s.ctx.final {
			return s, true
		}
	}
	return leadSend{}, false
}

func TestGateInjectedLeadDispatchReachesFinalReply(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		_, _ = w.Write([]byte(`{"action":"reply"}`))
	}))
	defer srv.Close()
	p := &leadPlatform{}
	sess := &injectTurnSession{events: make(chan Event, 4)}
	e := NewEngine("test", &injectTurnAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	e.SetGate(srv.URL+"/decide", 1000, "reply")
	e.SetGateBurstWindow(30)

	key := "test:room-2"
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "278", UserID: "user", UserName: "用户",
		Content: "@橘 请 @龙娘 帮你算 17×23", Mentioned: true, ReplyCtx: leadCtx{id: "278"}})
	deadline := time.Now().Add(3 * time.Second)
	for !e.sessions.GetOrCreateActive(key).Busy() {
		if time.Now().After(deadline) {
			t.Fatal("first turn never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "279", UserID: "ju", UserName: "橘",
		FromBot: true, Content: "@龙娘 帮我算一下 17×23", Mentioned: true, ReplyCtx: leadCtx{id: "279", lead: true}})

	for {
		if s, ok := p.final(); ok {
			if s.content != "391" {
				t.Fatalf("final reply = %q", s.content)
			}
			if !s.ctx.lead {
				t.Fatalf("final reply ctx %+v lost the lead dispatch of the injected message", s.ctx)
			}
			return
		}
		if time.Now().After(deadline) {
			p.mu.Lock()
			t.Fatalf("no final reply; sent = %+v", p.sent)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
