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

// maomao fork (user 2026-10-22: "我说暂停，还要等个40分钟"): when the gate says "abort" while a turn
// is running, the running turn must be cancelled once (same path as /stop) and the message must
// start a new turn, not wait behind the old one.

type abortTurnSession struct {
	events  chan Event
	mu      sync.Mutex
	prompts []string
	cancels int
}

func (s *abortTurnSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	n := len(s.prompts)
	s.mu.Unlock()
	if n >= 2 { // the new turn answers right away; the first one only ends when cancelled
		go func() { s.events <- Event{Type: EventResult, Content: "好的，已暂停", Done: true} }()
	}
	return nil
}
func (s *abortTurnSession) CancelTurn() error {
	s.mu.Lock()
	s.cancels++
	s.mu.Unlock()
	go func() { s.events <- Event{Type: EventResult, Content: "", Done: true} }()
	return nil
}
func (s *abortTurnSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *abortTurnSession) Events() <-chan Event                             { return s.events }
func (s *abortTurnSession) CurrentSessionID() string                         { return "abort-1" }
func (s *abortTurnSession) Alive() bool                                      { return true }
func (s *abortTurnSession) Close() error                                     { return nil }

type abortTurnAgent struct{ s *abortTurnSession }

func (a *abortTurnAgent) Name() string { return "codex" }
func (a *abortTurnAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.s, nil
}
func (a *abortTurnAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *abortTurnAgent) Stop() error                                              { return nil }
func (a *abortTurnAgent) SupportsMidTurnInput() bool                               { return true }

func TestGateAbortWhileBusyStopsTurnAndStartsNewOne(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		var body strings.Builder
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		body.Write(buf[:n])
		if strings.Contains(body.String(), "暂停") {
			_, _ = w.Write([]byte(`{"action":"abort"}`))
			return
		}
		_, _ = w.Write([]byte(`{"action":"reply"}`))
	}))
	defer srv.Close()
	p := &leadPlatform{}
	sess := &abortTurnSession{events: make(chan Event, 8)}
	e := NewEngine("test", &abortTurnAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	e.SetGate(srv.URL+"/decide", 1000, "reply")

	key := "test:room-abort"
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "1", UserID: "user", UserName: "用户",
		Content: "跑一个很长的任务", Mentioned: true, ReplyCtx: leadCtx{id: "1"}})
	deadline := time.Now().Add(5 * time.Second)
	for !e.sessions.GetOrCreateActive(key).Busy() {
		if time.Now().After(deadline) {
			t.Fatal("first turn never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "2", UserID: "user", UserName: "用户",
		Content: "暂停", Mentioned: true, ReplyCtx: leadCtx{id: "2"}})

	for {
		sess.mu.Lock()
		cancels, prompts := sess.cancels, append([]string(nil), sess.prompts...)
		sess.mu.Unlock()
		if len(prompts) >= 2 {
			if cancels != 1 {
				t.Fatalf("CancelTurn called %d times, want 1", cancels)
			}
			if !strings.Contains(prompts[1], "暂停") {
				t.Fatalf("second turn prompt = %q, want the abort message", prompts[1])
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("abort message never started a new turn; cancels=%d prompts=%q sent=%+v", cancels, prompts, p.sent)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
