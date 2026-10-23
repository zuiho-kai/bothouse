package core

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// maomao fork (2026-10-23 20:06, user to 彩虹猫「暂停，你在干啥」→ channel got "❌ 错误: session reset";
// review ~/.claude/reviews/agy-abort-reset.md): a gate abort cancels only the running turn. A
// message queued behind that turn is still answered, nobody gets an error, and the abort
// message's question becomes a turn that is answered.

type queueAbortSession struct {
	events  chan Event
	mu      sync.Mutex
	prompts []string
	cancels int
}

func (s *queueAbortSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	n := len(s.prompts)
	s.mu.Unlock()
	if n >= 2 { // later turns answer right away; the first one runs until cancelled
		answer := "答复" + string(rune('0'+n))
		go func() { s.events <- Event{Type: EventResult, Content: answer, Done: true} }()
	}
	return nil
}

// CancelTurn ends the turn the way ACP, agy, codex and claude do after this fix: one EventError.
func (s *queueAbortSession) CancelTurn() error {
	s.mu.Lock()
	s.cancels++
	s.mu.Unlock()
	go func() { s.events <- Event{Type: EventError, Error: errors.New("turn cancelled")} }()
	return nil
}
func (s *queueAbortSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *queueAbortSession) Events() <-chan Event                             { return s.events }
func (s *queueAbortSession) CurrentSessionID() string                         { return "queue-abort-1" }
func (s *queueAbortSession) Alive() bool                                      { return true }
func (s *queueAbortSession) Close() error                                     { return nil }

func (s *queueAbortSession) snapshot() ([]string, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.prompts...), s.cancels
}

// No mid-turn input (like agy): a message sent while the turn runs is queued.
type queueAbortAgent struct{ s *queueAbortSession }

func (a *queueAbortAgent) Name() string { return "antigravity" }
func (a *queueAbortAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.s, nil
}
func (a *queueAbortAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *queueAbortAgent) Stop() error                                              { return nil }

func TestGateAbortKeepsQueuedMessageAndAnswersQuestion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		buf := make([]byte, 8192)
		n, _ := r.Body.Read(buf)
		if strings.Contains(string(buf[:n]), "暂停") {
			_, _ = w.Write([]byte(`{"action":"abort"}`))
			return
		}
		_, _ = w.Write([]byte(`{"action":"reply"}`))
	}))
	defer srv.Close()
	sess := &queueAbortSession{events: make(chan Event, 8)}
	p := &leadPlatform{}
	e := NewEngine("test", &queueAbortAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	e.SetGate(srv.URL+"/decide", 1000, "reply")

	key := "test:room-abort-queue"
	send := func(id, text string) {
		e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: id, UserID: "user", UserName: "用户",
			Content: text, Mentioned: true, ReplyCtx: leadCtx{id: id}})
	}
	send("1", "跑一个很长的任务")
	deadline := time.Now().Add(5 * time.Second)
	for !e.sessions.GetOrCreateActive(key).Busy() {
		if time.Now().After(deadline) {
			t.Fatal("first turn never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
	send("2", "顺便再看看日志")
	// wait until message 2 is queued behind the running turn
	for {
		e.interactiveMu.Lock()
		var queued int
		for _, st := range e.interactiveStates {
			st.mu.Lock()
			queued += len(st.pendingMessages)
			st.mu.Unlock()
		}
		e.interactiveMu.Unlock()
		if queued > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("message 2 was never queued")
		}
		time.Sleep(10 * time.Millisecond)
	}
	send("3", "暂停，你在干啥")

	deadline = time.Now().Add(10 * time.Second)
	for {
		prompts, cancels := sess.snapshot()
		var sawQueued, sawQuestion bool
		for _, pr := range prompts[min(1, len(prompts)):] {
			sawQueued = sawQueued || strings.Contains(pr, "顺便再看看日志")
			sawQuestion = sawQuestion || strings.Contains(pr, "你在干啥")
		}
		if sawQueued && sawQuestion {
			if cancels != 1 {
				t.Fatalf("CancelTurn called %d times, want 1", cancels)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("queued message or abort question never reached the agent; prompts=%q sent=%+v", prompts, p.sent)
		}
		time.Sleep(10 * time.Millisecond)
	}
	// both later turns are answered in the channel and nothing is an error
	deadline = time.Now().Add(5 * time.Second)
	for {
		p.mu.Lock()
		sent := append([]leadSend(nil), p.sent...)
		p.mu.Unlock()
		answers := 0
		for _, m := range sent {
			if strings.Contains(m.content, "❌") || strings.Contains(m.content, "session cancelled") || strings.Contains(m.content, "session reset") {
				t.Fatalf("error sent to the channel after abort: %+v", sent)
			}
			if strings.Contains(m.content, "答复") {
				answers++
			}
		}
		if answers >= 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("answers in channel = %d, want 2 (queued message and the question); sent=%+v", answers, sent)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
