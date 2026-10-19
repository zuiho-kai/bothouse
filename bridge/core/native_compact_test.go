package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type nativeCompactAgent struct {
	stubStrictModelAgent
	called  chan string
	release chan error
}

func (a *nativeCompactAgent) CompactSession(ctx context.Context, id string) error {
	a.called <- id + ":" + a.GetModel()
	select {
	case err := <-a.release:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
func compactFixture(t *testing.T) (*Engine, *nativeCompactAgent, *stubPlatformEngine, *Session) {
	t.Helper()
	a := &nativeCompactAgent{stubStrictModelAgent: stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "old"}, models: []ModelOption{{Name: "old"}, {Name: "new"}}}, called: make(chan string, 4), release: make(chan error, 4)}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("compact", a, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	s := e.sessions.GetOrCreateActive("test:compact")
	s.SetAgentSessionID("original-thread", a.Name())
	s.AddHistory("user", "remember this")
	t.Cleanup(func() { e.cancel() })
	return e, a, p, s
}
func compactMessage(text string) *Message {
	return &Message{SessionKey: "test:compact", Platform: "test", UserID: "human", Content: text, ReplyCtx: "local"}
}
func waitCompactText(t *testing.T, p *stubPlatformEngine, text string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(strings.Join(p.getSent(), "\n"), text) {
			return
		}
		time.Sleep(time.Millisecond * 5)
	}
	t.Fatalf("missing %q in %v", text, p.getSent())
}
func TestNativeCompactColdSessionPreservesHistory(t *testing.T) {
	e, a, p, s := compactFixture(t)
	e.cmdCompress(p, compactMessage("/compact"))
	select {
	case got := <-a.called:
		if got != "original-thread:old" {
			t.Fatal(got)
		}
	case <-time.After(time.Second):
		t.Fatalf("native compression not called: %v", p.getSent())
	}
	if strings.Contains(strings.Join(p.getSent(), "\n"), e.i18n.T(MsgCompressDone)) {
		t.Fatal("reported success before completion")
	}
	a.release <- nil
	waitCompactText(t, p, e.i18n.T(MsgCompressDone))
	if s.GetAgentSessionID() != "original-thread" || len(s.GetHistory(100)) != 1 {
		t.Fatal("changed conversation")
	}
}
func TestNativeCompactBusyAndFailure(t *testing.T) {
	e, a, p, s := compactFixture(t)
	s.TryLock()
	e.cmdCompress(p, compactMessage("/compact"))
	waitCompactText(t, p, e.i18n.T(MsgPreviousProcessing))
	s.Unlock()
	select {
	case <-a.called:
		t.Fatal("compressed busy session")
	default:
	}
	p.clearSent()
	e.cmdCompress(p, compactMessage("/compact"))
	select {
	case <-a.called:
	case <-time.After(time.Second):
		t.Fatal("not called")
	}
	a.release <- errors.New("Selected model is at capacity")
	waitCompactText(t, p, "Selected model is at capacity")
	if strings.Contains(strings.Join(p.getSent(), "\n"), e.i18n.T(MsgCompressDone)) {
		t.Fatal("false success")
	}
}
func TestCUJ_Compact1_ModelSwitchCompressStopRetry(t *testing.T) {
	e, a, p, s := compactFixture(t)
	e.ReceiveMessage(p, compactMessage("/model new"))
	e.ReceiveMessage(p, compactMessage("/compact"))
	select {
	case got := <-a.called:
		if got != "original-thread:new" {
			t.Fatal(got)
		}
	case <-time.After(time.Second):
		t.Fatalf("not called: %v", p.getSent())
	}
	e.ReceiveMessage(p, compactMessage("/stop"))
	waitCompactText(t, p, e.i18n.T(MsgExecutionStopped))
	deadline := time.Now().Add(time.Second)
	for s.Busy() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond * 5)
	}
	p.clearSent()
	e.ReceiveMessage(p, compactMessage("/compact"))
	select {
	case <-a.called:
	case <-time.After(time.Second):
		t.Fatal("not retryable")
	}
	a.release <- nil
	waitCompactText(t, p, e.i18n.T(MsgCompressDone))
	deadline = time.Now().Add(time.Second)
	for s.Busy() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond * 5)
	}
	e.ReceiveMessage(p, compactMessage("continue"))
	waitCompactText(t, p, "continued original")
	if s.GetAgentSessionID() != "original-thread" || len(s.GetHistory(100)) != 3 {
		t.Fatal("changed conversation")
	}
}

type compactChatSession struct {
	stubAgentSession
	id     string
	events chan Event
}

func (s *compactChatSession) CurrentSessionID() string { return s.id }
func (s *compactChatSession) Events() <-chan Event     { return s.events }
func (s *compactChatSession) Send(_ string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.events <- Event{Type: EventResult, Content: "continued original", SessionID: s.id, Done: true}
	return nil
}
func (a *nativeCompactAgent) StartSession(_ context.Context, id string) (AgentSession, error) {
	return &compactChatSession{id: id, events: make(chan Event, 8)}, nil
}
func TestNativeCompactPendingSwitchAndNoSession(t *testing.T) {
	e, a, p, s := compactFixture(t)
	e.queueSwitch("test:compact", pendingModelSwitch{model: "new"})
	e.cmdCompress(p, compactMessage("/compact"))
	select {
	case got := <-a.called:
		if got != "original-thread:new" {
			t.Fatal(got)
		}
	case <-time.After(time.Second):
		t.Fatal("not called")
	}
	a.release <- nil
	waitCompactText(t, p, e.i18n.T(MsgCompressDone))
	deadline := time.Now().Add(time.Second)
	for s.Busy() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond * 5)
	}
	s.SetAgentSessionID("", "")
	p.clearSent()
	e.cmdCompress(p, compactMessage("/compact"))
	waitCompactText(t, p, e.i18n.T(MsgCompressNoSession))
	select {
	case <-a.called:
		t.Fatal("created replacement session")
	default:
	}
}

func TestNativeCompactRejectsMessagesDuringCompression(t *testing.T) {
	e, a, p, s := compactFixture(t)
	e.ReceiveMessage(p, compactMessage("/compact"))
	select {
	case <-a.called:
	case <-time.After(time.Second):
		t.Fatal("not called")
	}
	p.clearSent()
	e.ReceiveMessage(p, compactMessage("another message"))
	waitCompactText(t, p, e.i18n.T(MsgPreviousProcessing))
	if len(s.GetHistory(100)) != 1 {
		t.Fatal("message entered conversation during compression")
	}
	a.release <- nil
	waitCompactText(t, p, e.i18n.T(MsgCompressDone))
}

func TestNativeCompactUsesWorkspaceAgent(t *testing.T) {
	e, global, p, _ := compactFixture(t)
	workspace := &nativeCompactAgent{stubStrictModelAgent: stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "workspace-model"}}, called: make(chan string, 1), release: make(chan error, 1)}
	sessions := NewSessionManager(t.TempDir() + "/sessions.json")
	s := sessions.GetOrCreateActive("test:compact")
	s.SetAgentSessionID("workspace-thread", "stub")
	e.cmdNativeCompact(workspace, workspace, sessions, "workspace:test:compact", p, compactMessage("/compact"))
	select {
	case got := <-workspace.called:
		if got != "workspace-thread:workspace-model" {
			t.Fatal(got)
		}
	case <-time.After(time.Second):
		t.Fatal("not called")
	}
	select {
	case <-global.called:
		t.Fatal("used global agent")
	default:
	}
	workspace.release <- nil
	waitCompactText(t, p, e.i18n.T(MsgCompressDone))
}
