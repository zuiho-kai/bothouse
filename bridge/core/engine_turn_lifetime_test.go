package core

import (
	"context"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// #702: an agent process lives for a turn. These tests cover the end of a turn in an
// ordinary chat (no workspace, no idle timeout configured): the process closes when the
// next message can resume the conversation by its saved ID, and stays otherwise.

type turnLifetimeSession struct {
	id         string
	events     chan Event
	closed     atomic.Bool
	background atomic.Int32
}

func (s *turnLifetimeSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	s.events <- Event{Type: EventResult, Content: "ok", Done: true}
	return nil
}
func (s *turnLifetimeSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *turnLifetimeSession) Events() <-chan Event                             { return s.events }
func (s *turnLifetimeSession) CurrentSessionID() string                         { return s.id }
func (s *turnLifetimeSession) Alive() bool                                      { return !s.closed.Load() }
func (s *turnLifetimeSession) Close() error                                     { s.closed.Store(true); return nil }
func (s *turnLifetimeSession) BackgroundTasks() (int, time.Time) {
	return int(s.background.Load()), time.Time{}
}

// noResumeSession is a process that told us it cannot load a saved session (ACP
// initialize without loadSession or session/resume).
type noResumeSession struct{ *turnLifetimeSession }

func (noResumeSession) CanResume() bool { return false }

type turnLifetimeAgent struct {
	strict     bool
	noResume   bool
	background int32
	mu         sync.Mutex
	starts     []string // the saved ID each start asked to resume ("" = new)
	sessions   []*turnLifetimeSession
}

func (a *turnLifetimeAgent) Name() string { return "turn-lifetime" }
func (a *turnLifetimeAgent) StartSession(_ context.Context, id string) (AgentSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.starts = append(a.starts, id)
	sid := id
	if sid == "" {
		sid = "conv-1"
	}
	s := &turnLifetimeSession{id: sid, events: make(chan Event, 4)}
	s.background.Store(a.background)
	a.sessions = append(a.sessions, s)
	if a.noResume {
		return noResumeSession{s}, nil
	}
	return s, nil
}
func (a *turnLifetimeAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) {
	return nil, nil
}
func (a *turnLifetimeAgent) Stop() error { return nil }

type strictTurnLifetimeAgent struct{ *turnLifetimeAgent }

func (strictTurnLifetimeAgent) SupportsStrictResume() bool { return true }
func (a strictTurnLifetimeAgent) StartSessionStrict(ctx context.Context, id string) (AgentSession, error) {
	return a.StartSession(ctx, id)
}

func runTurnLifetimeTurn(t *testing.T, e *Engine, agent Agent, key string) {
	t.Helper()
	p := e.platforms[0]
	session := e.sessions.GetOrCreateActive(key)
	done := make(chan struct{})
	go func() {
		defer close(done)
		e.processInteractiveMessageWith(p, &Message{
			Platform: "test", SessionKey: key, UserID: "u1", UserName: "U", Content: "hi", ReplyCtx: "ctx",
		}, session, agent, e.sessions, key, "", "")
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("turn did not finish")
	}
}

func (a *turnLifetimeAgent) snapshot() ([]string, []*turnLifetimeSession) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.starts...), append([]*turnLifetimeSession(nil), a.sessions...)
}

func newTurnLifetimeEngine(t *testing.T, agent Agent) *Engine {
	t.Helper()
	p := &stubPlatformEngine{n: "test"}
	return NewEngine("test", agent, []Platform{p}, filepath.Join(t.TempDir(), "sessions.json"), LangEnglish)
}

func TestTurnEnd_ClosesResumableProcessAndNextMessageResumes(t *testing.T) {
	base := &turnLifetimeAgent{}
	agent := strictTurnLifetimeAgent{base}
	e := newTurnLifetimeEngine(t, agent)
	key := "test:chat:u1"

	runTurnLifetimeTurn(t, e, agent, key)
	waitForInteractiveStateRemoved(t, e, key)
	_, sessions := base.snapshot()
	if len(sessions) != 1 || !sessions[0].closed.Load() {
		t.Fatalf("process after the first turn: want closed, got %d sessions", len(sessions))
	}
	if got := e.sessions.GetOrCreateActive(key).GetAgentSessionID(); got != "conv-1" {
		t.Fatalf("saved agent session ID = %q, want conv-1 kept for resume", got)
	}

	runTurnLifetimeTurn(t, e, agent, key)
	waitForInteractiveStateRemoved(t, e, key)
	starts, _ := base.snapshot()
	if len(starts) != 2 || starts[0] != "" || starts[1] != "conv-1" {
		t.Fatalf("starts = %q, want a new conversation then a resume of conv-1", starts)
	}
}

func TestTurnEnd_KeepsProcessWhenAgentCannotResume(t *testing.T) {
	agent := &turnLifetimeAgent{} // no StrictResumeAgent: a restart could not find the conversation
	e := newTurnLifetimeEngine(t, agent)
	key := "test:chat:u1"
	runTurnLifetimeTurn(t, e, agent, key)
	time.Sleep(50 * time.Millisecond)
	_, sessions := agent.snapshot()
	if sessions[0].closed.Load() {
		t.Fatal("closed a process whose agent cannot resume: the next message would lose the context")
	}
}

func TestTurnEnd_KeepsProcessWhenServerCannotLoadSession(t *testing.T) {
	base := &turnLifetimeAgent{noResume: true}
	agent := strictTurnLifetimeAgent{base}
	e := newTurnLifetimeEngine(t, agent)
	key := "test:chat:u1"
	runTurnLifetimeTurn(t, e, agent, key)
	time.Sleep(50 * time.Millisecond)
	_, sessions := base.snapshot()
	if sessions[0].closed.Load() {
		t.Fatal("closed a process whose server cannot load a saved session")
	}
}

func TestTurnEnd_KeepsProcessWhileBackgroundWorkRuns(t *testing.T) {
	base := &turnLifetimeAgent{background: 1}
	agent := strictTurnLifetimeAgent{base}
	e := newTurnLifetimeEngine(t, agent)
	key := "test:chat:u1"
	runTurnLifetimeTurn(t, e, agent, key)
	time.Sleep(50 * time.Millisecond)
	_, sessions := base.snapshot()
	if sessions[0].closed.Load() {
		t.Fatal("closed a process with a background task running: its completion would be lost")
	}
}
