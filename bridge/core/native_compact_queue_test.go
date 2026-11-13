package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// compactQueueFixture: a native /compact is running on key; one message
// queued behind it (the way a cron job or a capacity re-delivery queues).
func compactQueueFixture(t *testing.T, workspaceDir string) (*Engine, *compactingAgent, *countingResultSession, *stubCronReplyTargetPlatform, string) {
	t.Helper()
	as := newCountingResultSession()
	a := newCompactingAgent(as)
	p := &stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("test", a, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "discord:channel-1:user-1"
	e.sessions.GetOrCreateActive(key).SetAgentSessionID("thread-1", a.Name())
	e.cmdNativeCompact(a, a, e.sessions, key, workspaceDir, p, &Message{SessionKey: key, Platform: "discord", UserID: "u", Content: "/compact", ReplyCtx: "rc"})
	waitCompactCall(t, a)
	e.ensureInteractiveStateForQueueing(key, p, "rc")
	if got := e.queueForBusySession(p, &Message{SessionKey: key, Platform: "discord", UserID: "timer", UserName: "timer", Content: "queued job", ReplyCtx: "rc"}, e.sessions.GetOrCreateActive(key), e.sessions, key, a, workspaceDir, p); got != queueAccepted {
		t.Fatalf("queue during /compact = %v, want queueAccepted", got)
	}
	return e, a, as, p, key
}

// The turn started after /compact runs in the compacted session's workspace.
func TestNativeCompact_QueuedTurnKeepsWorkspace(t *testing.T) {
	ws := t.TempDir()
	e, a, as, _, key := compactQueueFixture(t, ws)
	a.release <- nil
	waitFor(t, "queued turn ran", func() bool { return as.count() == 1 })
	waitFor(t, "session idle", func() bool { return !e.sessions.GetOrCreateActive(key).Busy() })
	e.interactiveMu.Lock()
	st := e.interactiveStates[key]
	e.interactiveMu.Unlock()
	if st == nil {
		t.Fatal("no interactive state after the queued turn")
	}
	st.mu.Lock()
	got := st.workspaceDir
	st.mu.Unlock()
	if got != ws {
		t.Fatalf("queued turn ran in workspace %q, want %q", got, ws)
	}
}

// If the session lock is taken by someone else the instant /compact ends, the
// queued turn still runs once it frees, without waiting for another message.
func TestNativeCompact_LockBusyAtEndRetries(t *testing.T) {
	as := newCountingResultSession()
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "test:c1"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() { // someone else holds the lock as /compact ends
		t.Fatal("lock")
	}
	e.interactiveMu.Lock()
	e.interactiveStates[key] = &interactiveState{platform: p, replyCtx: "rc",
		pendingMessages: []queuedMessage{{platform: p, replyCtx: "rc", content: "queued job", msgSessionKey: key, userID: "timer"}}}
	e.interactiveMu.Unlock()
	e.drainQueuedAfterNativeCompact(session, e.sessions, key, e.agent, "")
	time.Sleep(50 * time.Millisecond)
	session.Unlock()
	waitFor(t, "queued turn ran after the lock freed", func() bool { return as.count() == 1 })
	waitFor(t, "session idle", func() bool { return !session.Busy() })
}

// A real startup failure remains terminal for its queued input: do not attempt
// another startup just because the failed state has no agent process.
func TestDrainOrphanedQueue_FailedStartupDropsQueuedMessages(t *testing.T) {
	starts := 0
	a := &controllableAgent{startSessionFn: func(context.Context, string) (AgentSession, error) {
		starts++
		return nil, errors.New("agent binary not found")
	}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "test:c1"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("lock")
	}
	e.ensureInteractiveStateForQueueing(key, p, "rc")
	if got := e.enqueueForBusySession(p, &Message{SessionKey: key, Content: "queued", ReplyCtx: "rc"}, key, nil); got != queueAccepted {
		t.Fatal("message not queued behind startup")
	}
	state := e.getOrCreateInteractiveStateWith(key, p, "rc", session, e.sessions, nil, key)
	if state.agentSession != nil || state.startErr == "" {
		t.Fatal("test requires an actual failed startup")
	}
	e.drainOrphanedQueue(session, e.sessions, key, e.agent, "")
	if starts != 1 {
		t.Fatalf("failed startup retried: starts=%d, want 1", starts)
	}
	if !strings.Contains(strings.Join(p.getSent(), "\n"), "agent session ended") {
		t.Fatalf("sent = %#v, want the dropped-queue notice", p.getSent())
	}
	if !session.TryLock() {
		t.Fatal("session left locked")
	}
	session.Unlock()
}

func TestQueuedToMessageKeepsFromBot(t *testing.T) {
	if m := queuedToMessage(queuedMessage{fromBot: true}); !m.FromBot {
		t.Fatal("queuedToMessage dropped fromBot")
	}
}
