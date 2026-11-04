package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// A backend without CancelTurn must close its process to stop a turn. Its
// unsent queue belongs to the conversation, not to that process (#955).
type closeAbortSession struct {
	mu           sync.Mutex
	events       chan Event
	closed       bool
	prompts      []string
	answer       bool
	closeStarted chan struct{}
	closeWait    <-chan struct{}
}

func (s *closeAbortSession) Send(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	s.mu.Unlock()
	if s.answer {
		s.events <- Event{Type: EventResult, Content: "new answer", Done: true}
	}
	return nil
}
func (s *closeAbortSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *closeAbortSession) Events() <-chan Event                             { return s.events }
func (s *closeAbortSession) CurrentSessionID() string                         { return "close-abort" }
func (s *closeAbortSession) Alive() bool                                      { s.mu.Lock(); defer s.mu.Unlock(); return !s.closed }
func (s *closeAbortSession) Close() error {
	if s.closeStarted != nil {
		select {
		case s.closeStarted <- struct{}{}:
		default:
		}
		<-s.closeWait
	}
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	return nil
}

type closeAbortAgent struct {
	mu           sync.Mutex
	sessions     []*closeAbortSession
	cancelFails  bool
	closeStarted chan struct{}
	closeWait    <-chan struct{}
	restarted    chan struct{}
}

type failingCancelSession struct{ *closeAbortSession }

func (s *failingCancelSession) CancelTurn() error {
	return errors.New("session process is not running")
}

func (a *closeAbortAgent) Name() string { return "fake" }
func (a *closeAbortAgent) StartSession(context.Context, string) (AgentSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := &closeAbortSession{events: make(chan Event, 8), answer: len(a.sessions) > 0}
	if len(a.sessions) == 0 {
		s.closeStarted, s.closeWait = a.closeStarted, a.closeWait
	}
	if len(a.sessions) > 0 && a.restarted != nil {
		a.restarted <- struct{}{}
	}
	a.sessions = append(a.sessions, s)
	if len(a.sessions) == 1 && a.cancelFails {
		return &failingCancelSession{s}, nil
	}
	return s, nil
}
func (a *closeAbortAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *closeAbortAgent) Stop() error                                              { return nil }
func (a *closeAbortAgent) prompts() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	var prompts []string
	for _, s := range a.sessions {
		s.mu.Lock()
		prompts = append(prompts, s.prompts...)
		s.mu.Unlock()
	}
	return prompts
}

func TestGateAbortClosePreservesQueuedMessages(t *testing.T) {
	for _, kind := range []string{"no-cancel", "cancel-fails", "process-exited", "slow-close"} {
		t.Run(kind, func(t *testing.T) { runGateAbortClose(t, kind) })
	}
}

func runGateAbortClose(t *testing.T, kind string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		var req gateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
			return
		}
		if req.Content == "change direction" {
			_, _ = w.Write([]byte(`{"action":"abort"}`))
			return
		}
		_, _ = w.Write([]byte(`{"action":"reply"}`))
	}))
	defer srv.Close()
	a := &closeAbortAgent{cancelFails: kind != "no-cancel"}
	var releaseClose func()
	if kind == "slow-close" {
		release := make(chan struct{})
		var once sync.Once
		releaseClose = func() { once.Do(func() { close(release) }) }
		a.closeStarted, a.closeWait, a.restarted = make(chan struct{}, 1), release, make(chan struct{}, 1)
	}
	p := &leadPlatform{}
	e := NewEngine("test", a, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	if releaseClose != nil {
		defer releaseClose() // release the backend barrier before engine shutdown on failure
	}
	e.SetGate(srv.URL+"/decide", 1000, "reply")
	const key = "test:close-abort"
	send := func(id, text string) {
		e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: id,
			UserID: "user", UserName: "user", Content: text, Mentioned: true, ReplyCtx: leadCtx{id: id}})
	}
	send("1", "original task")
	waitFor(t, "original task sent", func() bool { return len(a.prompts()) == 1 })
	send("2", "queued supplement")
	waitFor(t, "supplement queued", func() bool {
		e.interactiveMu.Lock()
		defer e.interactiveMu.Unlock()
		s := e.interactiveStates[key]
		if s == nil {
			return false
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		return len(s.pendingMessages) == 1
	})
	if kind == "process-exited" {
		a.mu.Lock()
		old := a.sessions[0]
		a.mu.Unlock()
		_ = old.Close()
	}
	send("3", "change direction")
	if kind == "slow-close" {
		select {
		case <-a.closeStarted:
		case <-time.After(5 * time.Second):
			t.Fatal("old process close never began")
		}
		send("4", "message during close")
		waitFor(t, "new message queued during close", func() bool {
			p.mu.Lock()
			defer p.mu.Unlock()
			for _, m := range p.sent {
				if m.ctx.id == "4" && strings.Contains(m.content, "📬") {
					return true
				}
			}
			return false
		})
		select {
		case <-a.restarted:
			releaseClose()
			t.Fatal("replacement process started before the cancelled process closed")
		case <-time.After(100 * time.Millisecond):
		}
		releaseClose()
	}
	waitFor(t, "cancelled turn handed off and released", func() bool {
		return len(a.prompts()) > 1 && !e.sessions.GetOrCreateActive(key).Busy()
	})
	p.mu.Lock()
	sent := append([]leadSend(nil), p.sent...)
	p.mu.Unlock()
	for _, m := range sent {
		if strings.Contains(m.content, "session reset") || strings.Contains(m.content, "❌") {
			t.Fatalf("cancel leaked queue failure: %+v", sent)
		}
	}
	notices := 0
	answers := 0
	for _, m := range sent {
		if strings.Contains(m.content, "📬") {
			notices++
		}
		if strings.Contains(m.content, "new answer") {
			answers++
		}
	}
	wantNotices, wantAnswers := 1, 2
	wantPrompts := []string{"original task", "queued supplement", "change direction"}
	if kind == "slow-close" {
		wantNotices = 2 // same-sender pending messages are batched into the second answer
		wantPrompts = append(wantPrompts, "message during close")
	}
	if notices != wantNotices || answers != wantAnswers {
		t.Fatalf("want %d queue notices and %d answers; sent=%+v", wantNotices, wantAnswers, sent)
	}
	prompts := a.prompts()
	for _, text := range wantPrompts {
		count := 0
		for _, prompt := range prompts {
			count += strings.Count(prompt, text)
		}
		if count != 1 {
			t.Fatalf("%q delivered %d times, want once; prompts=%q", text, count, prompts)
		}
	}
	if len(prompts) < 2 || !strings.Contains(prompts[1], "change direction") {
		t.Fatalf("redirect must run first after cancel; prompts=%q", prompts)
	}
}
