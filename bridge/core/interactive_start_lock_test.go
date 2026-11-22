package core

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type blockingStartAgent struct {
	stubAgent
	mu          sync.Mutex
	blockKey    string
	startedA    chan struct{}
	releaseA    chan struct{}
	startAErr   error
	returnedA   *stubAgentSession
	otherStarts int
}

func (a *blockingStartAgent) StartSession(ctx context.Context, sessionID string) (AgentSession, error) {
	if sessionID == "hang-id" {
		select {
		case <-a.startedA:
		default:
			close(a.startedA)
		}
		select {
		case <-a.releaseA:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		if a.startAErr != nil {
			return nil, a.startAErr
		}
		a.mu.Lock()
		a.returnedA = &stubAgentSession{}
		sess := a.returnedA
		a.mu.Unlock()
		return sess, nil
	}
	a.mu.Lock()
	a.otherStarts++
	a.mu.Unlock()
	return &stubAgentSession{}, nil
}

func TestGetOrCreateInteractiveStateWith_DoesNotBlockInteractiveMuDuringStartSession(t *testing.T) {
	p := &stubPlatformEngine{n: "discord"}
	agent := &blockingStartAgent{
		startedA:  make(chan struct{}),
		releaseA:  make(chan struct{}),
		startAErr: errors.New("acp: initialize: process exited"),
	}
	e := NewEngine("test", agent, []Platform{p}, "", LangEnglish)

	sessA := &Session{ID: "s-a"}
	sessA.SetAgentSessionID("hang-id", "stub")

	doneA := make(chan *interactiveState, 1)
	go func() {
		doneA <- e.getOrCreateInteractiveStateWith("discord:a", p, "ctx-a", sessA, e.sessions, nil, "")
	}()

	select {
	case <-agent.startedA:
	case <-time.After(2 * time.Second):
		t.Fatal("session A did not reach StartSession")
	}

	// While session A is stuck inside StartSession, another session and cleanup on
	// an unrelated key must acquire interactiveMu without waiting for session A.
	otherDone := make(chan *interactiveState, 1)
	go func() {
		otherDone <- e.getOrCreateInteractiveStateWith("discord:b", p, "ctx-b", &Session{ID: "s-b"}, e.sessions, nil, "")
	}()

	select {
	case stB := <-otherDone:
		if stB == nil || stB.agentSession == nil {
			t.Fatalf("session B did not start cleanly: %+v", stB)
		}
	case <-time.After(time.Second):
		t.Fatal("session B blocked on interactiveMu while session A was in StartSession")
	}

	cleanupDone := make(chan struct{})
	go func() {
		e.cleanupInteractiveState("discord:b")
		close(cleanupDone)
	}()
	select {
	case <-cleanupDone:
	case <-time.After(time.Second):
		t.Fatal("cleanupInteractiveState blocked on interactiveMu while session A was in StartSession")
	}

	// Unblock session A (simulating killed ACP child returning an error).
	close(agent.releaseA)
	select {
	case stA := <-doneA:
		if stA == nil || stA.startErr != "" && stA.agentSession != nil {
			t.Fatalf("unexpected session A state: %+v", stA)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("session A did not return after StartSession unblocked")
	}
}
