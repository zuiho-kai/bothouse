package core

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// Split the event loop and its caller's drain at their real call boundary.
// This fixes the interleaving without sleeps or a production test hook.
func TestExitedTurnDrainsReplacementQueueBeforeUnlock(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	recovered := &capacityScriptSession{events: make(chan Event, 1), script: []string{"human"}}
	a := &resultAgent{session: recovered}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "test:retirement-handoff"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("could not own the old turn")
	}
	t.Cleanup(func() { session.Unlock() })
	dead := &attributedFailSession{events: make(chan Event, 1), exitOnError: true, sends: 1}
	old := &interactiveState{agent: a, agentSession: dead, platform: p, replyCtx: "ctx", processClaimed: true}
	e.interactiveStates[key] = old
	dead.events <- Event{Type: EventError, Error: errors.New("agent crashed: turn failed")}
	e.processInteractiveEvents(old, session, e.sessions, key, "old", time.Now(), nil, nil, "ctx")
	e.interactiveMu.Lock()
	removed := e.interactiveStates[key] == nil
	e.interactiveMu.Unlock()
	if !removed || !session.Busy() {
		t.Fatal("interleaving requires cleanup complete with the old session still locked")
	}
	accepted := false
	e.handleMessage(p, &Message{SessionKey: key, Platform: p.Name(), UserID: "human",
		Content: mentionedNote + "\nplease reply", Mentioned: true, ReplyCtx: "ctx",
		OnAccepted: func() { accepted = true }})
	if !accepted || !strings.Contains(joined(p), e.i18n.T(MsgMessageQueued)) {
		t.Fatal("human message did not receive its queue receipt")
	}
	if !session.Busy() || recovered.sends() != 0 {
		t.Fatal("the old worker must still own the session before its drain")
	}
	if !e.drainPendingMessages(old, session, e.sessions, key) {
		t.Fatal("old worker did not release or hand off the session")
	}
	if out := joined(p); !strings.Contains(out, "reply:human") {
		t.Fatalf("accepted human message has no executor after retirement: sends=%d busy=%v output=%s", recovered.sends(), session.Busy(), out)
	}
	if session.Busy() || recovered.sends() != 1 {
		t.Fatalf("handoff must execute once and release the session: sends=%d busy=%v", recovered.sends(), session.Busy())
	}
	if !strings.Contains(recovered.sentPrompts()[0], mentionedNote) {
		t.Fatal("queued human message lost its must-reply instruction")
	}
}

func TestExitedTurnDoesNotTakeReplacementSessionQueue(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	recovered := &capacityScriptSession{events: make(chan Event, 1)}
	e := NewEngine("test", &resultAgent{session: recovered}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "test:replacement-session"
	oldSession := e.sessions.GetOrCreateActive(key)
	oldSession.TryLock()
	old := &interactiveState{agent: e.agent, platform: p, stopped: true, processClaimed: true}
	// /new has created a different conversation owner before the old worker
	// finishes. Its queued input must stay with its own still-running worker.
	newSession := e.sessions.NewSession(key, "replacement")
	newSession.TryLock()
	t.Cleanup(func() { oldSession.Unlock(); newSession.Unlock() })
	e.ensureInteractiveStateForQueueing(key, p, "ctx")
	e.handleMessage(p, &Message{SessionKey: key, Platform: p.Name(), UserID: "human", Content: "new conversation", ReplyCtx: "ctx"})
	if !e.drainPendingMessages(old, oldSession, e.sessions, key) {
		t.Fatal("old session not released")
	}
	e.interactiveMu.Lock()
	current := e.interactiveStates[key]
	current.mu.Lock()
	pending := len(current.pendingMessages)
	current.mu.Unlock()
	e.interactiveMu.Unlock()
	if oldSession.Busy() || !newSession.Busy() || recovered.sends() != 0 || pending != 1 {
		t.Fatalf("old worker crossed session ownership: old busy=%v new busy=%v sends=%d pending=%d", oldSession.Busy(), newSession.Busy(), recovered.sends(), pending)
	}
}

// Split handleMessage at its first failed TryLock: the retiring worker
// finishes before queueForBusySession publishes the already-admitted input.
func TestExitedTurnLateQueueRunsAfterUnlock(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	recovered := &capacityScriptSession{events: make(chan Event, 1), script: []string{"human"}}
	a := &resultAgent{session: recovered}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "test:late-retirement-handoff"
	session := e.sessions.GetOrCreateActive(key)
	if !session.TryLock() {
		t.Fatal("could not own the old turn")
	}
	t.Cleanup(func() { session.Unlock() })
	old := &interactiveState{agent: a, platform: p, stopped: true, processClaimed: true}
	e.ensureInteractiveStateForQueueing(key, p, "ctx")
	if session.TryLock() {
		t.Fatal("incoming message must first observe the retiring worker as busy")
	}
	if !e.drainPendingMessages(old, session, e.sessions, key) || session.Busy() {
		t.Fatal("old worker must unlock after seeing the empty replacement queue")
	}
	accepted := false
	msg := &Message{SessionKey: key, Platform: p.Name(), UserID: "human",
		Content: mentionedNote + "\nplease reply", Mentioned: true, ReplyCtx: "ctx",
		OnAccepted: func() { accepted = true }}
	if got := e.queueForBusySession(p, msg, session, e.sessions, key, a, "", nil); got != queueAccepted || !accepted {
		t.Fatalf("late input not accepted: outcome=%v accepted=%v", got, accepted)
	}
	waitFor(t, "late queue releases session", func() bool { return !session.Busy() })
	if out := joined(p); !strings.Contains(out, e.i18n.T(MsgMessageQueued)) || !strings.Contains(out, "reply:human") {
		t.Fatalf("accepted late human message has no business reply: sends=%d output=%s", recovered.sends(), out)
	}
	if recovered.sends() != 1 || !strings.Contains(recovered.sentPrompts()[0], mentionedNote) {
		t.Fatal("late input must execute once with its must-reply instruction")
	}
}

// A deferred orphan drain still holds the pre-/new Session. Run it after a
// replacement Session owns a fresh placeholder queue: the old lock must not
// grant startup of that queue (Hypatia P1 on ae3b41b94).
func TestOrphanDrainDoesNotStartReplacementSessionQueue(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	recovered := &capacityScriptSession{events: make(chan Event, 1), script: []string{"human"}}
	a := &resultAgent{session: recovered}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	key := "test:orphan-replacement-session"
	oldSession := e.sessions.GetOrCreateActive(key)
	if !oldSession.TryLock() {
		t.Fatal("could not hold the old session for the deferred orphan drain")
	}
	newSession := e.sessions.NewSession(key, "replacement")
	if !newSession.TryLock() {
		t.Fatal("could not own the replacement session startup")
	}
	t.Cleanup(func() { newSession.Unlock() })
	e.ensureInteractiveStateForQueueing(key, p, "ctx")
	e.handleMessage(p, &Message{SessionKey: key, Platform: p.Name(), UserID: "human",
		Content: "new conversation", ReplyCtx: "ctx"})
	e.drainOrphanedQueue(oldSession, e.sessions, key, a, "")
	e.interactiveMu.Lock()
	current := e.interactiveStates[key]
	current.mu.Lock()
	pending := len(current.pendingMessages)
	current.mu.Unlock()
	e.interactiveMu.Unlock()
	if oldSession.Busy() || !newSession.Busy() || recovered.sends() != 0 || pending != 1 {
		t.Fatalf("orphan drain crossed session ownership: old busy=%v new busy=%v sends=%d pending=%d", oldSession.Busy(), newSession.Busy(), recovered.sends(), pending)
	}
	if strings.Contains(joined(p), "agent session ended") {
		t.Fatal("replacement session queue was dropped by the old orphan drain")
	}
}
