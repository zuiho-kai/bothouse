package core

import (
	"strings"
	"testing"
	"time"
)

// Auto-compress for agents with native compaction (codex): the threshold check
// at a turn's end queues the compaction, which runs on the native path once the
// turn has released the session.

func autoNativeFixture(t *testing.T, maxTokens int, minGap time.Duration) (*Engine, *compactingAgent, *countingResultSession, *stubPlatformEngine, string) {
	t.Helper()
	as := newCountingResultSession()
	a := newCompactingAgent(as)
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", a, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetAutoCompressConfig(true, maxTokens, minGap)
	key := "test:auto-native"
	s := e.sessions.GetOrCreateActive(key)
	s.SetAgentSessionID("thread-1", a.Name())
	s.AddHistory("user", strings.Repeat("long context ", 50))
	return e, a, as, p, key
}

func runAutoNativeTurn(t *testing.T, e *Engine, p *stubPlatformEngine, key, text string) {
	t.Helper()
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("session busy before turn")
	}
	e.processInteractiveMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: text, ReplyCtx: "rc"}, session)
}

func assertNoNativeCompact(t *testing.T, a *compactingAgent) {
	t.Helper()
	select {
	case got := <-a.called:
		t.Fatalf("unexpected native compaction: %s", got)
	case <-time.After(200 * time.Millisecond):
	}
}

func TestAutoCompressNative_TriggersAfterTurn(t *testing.T) {
	e, a, as, p, key := autoNativeFixture(t, 4, 30*time.Minute)
	runAutoNativeTurn(t, e, p, key, "hello")
	got := waitCompactCall(t, a)
	if !strings.HasPrefix(got, "counting|") {
		t.Fatalf("compacted %q, want the turn's thread", got)
	}
	if n := as.count(); n != 1 {
		t.Fatalf("turn sends = %d, want 1 (compaction must not replace the turn)", n)
	}
	sent := strings.Join(p.getSent(), "\n")
	if !strings.Contains(sent, e.i18n.T(MsgCompressing)) || !strings.Contains(sent, "k tokens)") {
		t.Fatalf("missing compressing notice: %v", p.getSent())
	}
	a.release <- nil
	waitFor(t, "session idle", func() bool { return !e.sessions.GetOrCreateActive(key).Busy() })
	if strings.Contains(strings.Join(p.getSent(), "\n"), e.i18n.T(MsgCompressDone)) {
		t.Fatalf("auto compaction reported done: %v", p.getSent())
	}
}

func TestAutoCompressNative_BelowThresholdSkips(t *testing.T) {
	e, a, _, p, key := autoNativeFixture(t, 1_000_000, 0)
	runAutoNativeTurn(t, e, p, key, "hello")
	assertNoNativeCompact(t, a)
}

func TestAutoCompressNative_MinGapSkipsRepeat(t *testing.T) {
	e, a, _, p, key := autoNativeFixture(t, 4, 30*time.Minute)
	runAutoNativeTurn(t, e, p, key, "first")
	waitCompactCall(t, a)
	a.release <- nil
	waitFor(t, "session idle", func() bool { return !e.sessions.GetOrCreateActive(key).Busy() })
	runAutoNativeTurn(t, e, p, key, "second")
	assertNoNativeCompact(t, a)
}

func TestAutoCompressNative_BusySessionSkips(t *testing.T) {
	e, a, _, p, key := autoNativeFixture(t, 4, 0)
	state := &interactiveState{platform: p, replyCtx: "rc", autoCompactDue: true}
	e.interactiveMu.Lock()
	e.interactiveStates[key] = state
	e.interactiveMu.Unlock()
	session := e.sessions.GetOrCreateActive(key)
	session.TryLock()
	e.applyPendingAutoCompact(key, key, e.sessions, a, "")
	session.Unlock()
	assertNoNativeCompact(t, a)
	state.mu.Lock()
	due := state.autoCompactDue
	state.mu.Unlock()
	if due {
		t.Fatal("due flag kept; the next turn's end re-checks the threshold")
	}
}

// Agents that compress by sending a command keep the in-turn path.
func TestAutoCompressNative_CommandAgentNotQueued(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	sess := newQueuingSession("auto-compress-cmd")
	e := NewEngine("test", &stubCompressorAgent{cmd: "/compact"}, []Platform{p}, "", LangEnglish)
	e.SetAutoCompressConfig(true, 4, 0)
	key := "test:user1"
	state := &interactiveState{agentSession: sess, platform: p, replyCtx: "ctx"}
	e.interactiveMu.Lock()
	e.interactiveStates[key] = state
	e.interactiveMu.Unlock()
	session := e.sessions.GetOrCreateActive(key)
	session.AddHistory("user", "hello world")
	go e.processInteractiveEvents(state, session, e.sessions, key, "msg1", time.Now(), func() {}, nil, nil)
	sess.events <- Event{Type: EventResult, Content: "response", Done: true}
	waitFor(t, "/compact sent in turn", func() bool {
		sess.sendMu.Lock()
		defer sess.sendMu.Unlock()
		return len(sess.sendCalls) > 0 && sess.sendCalls[len(sess.sendCalls)-1] == "/compact"
	})
	state.mu.Lock()
	due := state.autoCompactDue
	state.mu.Unlock()
	if due {
		t.Fatal("command agent queued a native compaction")
	}
}
