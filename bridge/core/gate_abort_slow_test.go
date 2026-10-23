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

// maomao fork (user 2026-10-23: "暂停，你在干啥"): when the cancelled turn takes longer than
// recalledStopLockWait to end, the abort message must not be injected into that cancelled turn
// (it would be lost or answered by the wrong turn). It must queue and be answered by the next turn.

type slowCancelSession struct {
	events      chan Event
	mu          sync.Mutex
	prompts     []string
	sentEarly   []bool // per prompt: sent before the cancelled turn ended
	cancels     int
	cancelEnded bool
}

func (s *slowCancelSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	s.sentEarly = append(s.sentEarly, s.cancels > 0 && !s.cancelEnded)
	n := len(s.prompts)
	s.mu.Unlock()
	if n >= 2 {
		go func() { s.events <- Event{Type: EventResult, Content: "好的，已暂停", Done: true} }()
	}
	return nil
}
func (s *slowCancelSession) CancelTurn() error {
	s.mu.Lock()
	s.cancels++
	s.mu.Unlock()
	go func() {
		time.Sleep(recalledStopLockWait + 700*time.Millisecond) // the turn ends after the gate stopped waiting
		s.mu.Lock()
		s.cancelEnded = true
		s.mu.Unlock()
		s.events <- Event{Type: EventResult, Content: "", Done: true}
	}()
	return nil
}
func (s *slowCancelSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *slowCancelSession) Events() <-chan Event                             { return s.events }
func (s *slowCancelSession) CurrentSessionID() string                         { return "slow-cancel-1" }
func (s *slowCancelSession) Alive() bool                                      { return true }
func (s *slowCancelSession) Close() error                                     { return nil }

type slowCancelAgent struct{ s *slowCancelSession }

func (a *slowCancelAgent) Name() string { return "codex" }
func (a *slowCancelAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.s, nil
}
func (a *slowCancelAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *slowCancelAgent) Stop() error                                              { return nil }
func (a *slowCancelAgent) SupportsMidTurnInput() bool                               { return true }

func TestGateAbortSlowCancelQueuesInsteadOfInjecting(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		if strings.Contains(string(buf[:n]), "暂停") {
			_, _ = w.Write([]byte(`{"action":"abort"}`))
			return
		}
		_, _ = w.Write([]byte(`{"action":"reply"}`))
	}))
	defer srv.Close()
	sess := &slowCancelSession{events: make(chan Event, 8)}
	p := &leadPlatform{}
	e := NewEngine("test", &slowCancelAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	e.SetGate(srv.URL+"/decide", 1000, "reply")

	key := "test:room-slow-cancel"
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "1", UserID: "user", UserName: "用户",
		Content: "跑一个很长的任务", Mentioned: true, ReplyCtx: leadCtx{id: "1"}})
	deadline := time.Now().Add(10 * time.Second)
	for !e.sessions.GetOrCreateActive(key).Busy() {
		if time.Now().After(deadline) {
			t.Fatal("first turn never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "2", UserID: "user", UserName: "用户",
		Content: "暂停，你在干啥", Mentioned: true, ReplyCtx: leadCtx{id: "2"}})

	for {
		sess.mu.Lock()
		cancels, prompts, early := sess.cancels, append([]string(nil), sess.prompts...), append([]bool(nil), sess.sentEarly...)
		sess.mu.Unlock()
		p.mu.Lock()
		answered := false
		for _, m := range p.sent {
			if strings.Contains(m.content, "好的，已暂停") {
				answered = true
			}
		}
		sent := append([]leadSend(nil), p.sent...)
		p.mu.Unlock()
		if len(prompts) >= 2 {
			if early[1] {
				t.Fatalf("abort message was sent into the cancelled turn before it ended; prompts=%q sent=%+v", prompts, sent)
			}
			if cancels != 1 {
				t.Fatalf("CancelTurn called %d times, want 1", cancels)
			}
			if !strings.Contains(prompts[1], "你在干啥") {
				t.Fatalf("second turn prompt = %q, want the abort message", prompts[1])
			}
			if answered {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("abort message never answered; cancels=%d prompts=%q sent=%+v", cancels, prompts, sent)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
