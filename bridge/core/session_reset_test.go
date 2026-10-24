package core

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// resetOrderPlatform records which conversation was active whenever the bridge
// delivered something to the chat.
type resetOrderPlatform struct {
	*stubPlatformEngine
	mu     sync.Mutex
	active func() string
	seen   map[string]string // content -> active session id at delivery
}

func (p *resetOrderPlatform) record(content string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.seen == nil {
		p.seen = map[string]string{}
	}
	p.seen[content] = p.active()
}

func (p *resetOrderPlatform) Reply(ctx context.Context, rc any, content string) error {
	p.record(content)
	return p.stubPlatformEngine.Reply(ctx, rc, content)
}

func (p *resetOrderPlatform) Send(ctx context.Context, rc any, content string) error {
	p.record(content)
	return p.stubPlatformEngine.Send(ctx, rc, content)
}

func (p *resetOrderPlatform) activeAt(content string) (string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for c, id := range p.seen {
		if strings.Contains(c, content) {
			return id, true
		}
	}
	return "", false
}

// resetDuringTurnSession calls `session new --after-turn` from inside its turn,
// then replies.
type resetDuringTurnSession struct {
	events  chan Event
	onTurn  func()
	turnRan sync.Once
}

func (s *resetDuringTurnSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	s.turnRan.Do(func() {
		s.onTurn()
		s.events <- Event{Type: EventResult, Content: "final answer", Done: true}
	})
	return nil
}
func (s *resetDuringTurnSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *resetDuringTurnSession) Events() <-chan Event                             { return s.events }
func (s *resetDuringTurnSession) CurrentSessionID() string                         { return "agent-old" }
func (s *resetDuringTurnSession) Alive() bool                                      { return true }
func (s *resetDuringTurnSession) Close() error                                     { return nil }

func TestSessionResetAfterTurnRunsAfterReply(t *testing.T) {
	const key = "test:c1"
	sess := &resetDuringTurnSession{events: make(chan Event, 4)}
	p := &resetOrderPlatform{stubPlatformEngine: &stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	p.active = func() string { return e.sessions.ActiveSessionID(key) }
	oldID := e.sessions.GetOrCreateActive(key).ID

	var queued SessionResetResult
	var midTurnID string
	sess.onTurn = func() {
		r, err := e.QueueSessionReset(key)
		if err != nil {
			t.Errorf("QueueSessionReset: %v", err)
		}
		queued = r
		midTurnID = e.sessions.ActiveSessionID(key)
	}

	e.handleMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "reset after the turn", func() bool { return e.sessions.ActiveSessionID(key) != oldID })

	if !queued.OK || !queued.Queued {
		t.Fatalf("mid-turn request should be queued, got %+v", queued)
	}
	if midTurnID != oldID {
		t.Fatalf("session was reset mid-turn: %q -> %q", oldID, midTurnID)
	}
	at, ok := p.activeAt("final answer")
	if !ok {
		t.Fatalf("reply never delivered: %v", p.getSent())
	}
	if at != oldID {
		t.Fatalf("reply was delivered after the reset (active %q, want old %q)", at, oldID)
	}
	if s := e.sessions.GetOrCreateActive(key); s.GetAgentSessionID() != "" {
		t.Fatalf("fresh session should not resume the old agent session, got %q", s.GetAgentSessionID())
	}
}

func TestSessionResetImmediateWhenIdle(t *testing.T) {
	e := newTestEngine()
	defer e.Stop()
	old := e.sessions.GetOrCreateActive("test:c1")
	old.SetAgentSessionID("agent-old", "stub")

	r, err := e.QueueSessionReset("test:c1")
	if err != nil {
		t.Fatal(err)
	}
	if !r.OK || r.Queued {
		t.Fatalf("idle session should reset now, got %+v", r)
	}
	if s := e.sessions.GetOrCreateActive("test:c1"); s == old || s.GetAgentSessionID() != "" {
		t.Fatal("session was not reset")
	}
	if old.GetAgentSessionID() != "" {
		t.Fatal("old session can still be resumed")
	}
}

// A session that is locked by something other than a turn ending later still
// gets its reset once the lock is released and the hook runs.
func TestSessionResetQueuedWhileBusyAppliesOnRelease(t *testing.T) {
	e := newTestEngine()
	defer e.Stop()
	old := e.sessions.GetOrCreateActive("test:c1")
	if !old.TryLock() {
		t.Fatal("lock")
	}
	r, err := e.QueueSessionReset("test:c1")
	if err != nil || !r.Queued {
		t.Fatalf("busy session should queue: %+v %v", r, err)
	}
	if e.sessions.GetOrCreateActive("test:c1") != old {
		t.Fatal("reset ran while the session was busy")
	}
	old.Unlock()
	if !e.applyPendingReset("test:c1") {
		t.Fatal("queued reset did not run after the turn")
	}
	if e.sessions.GetOrCreateActive("test:c1") == old {
		t.Fatal("session was not reset")
	}
	if e.applyPendingReset("test:c1") {
		t.Fatal("a reset must run once")
	}
}

func TestSessionResetLeavesOtherSessionsAlone(t *testing.T) {
	e := newTestEngine()
	defer e.Stop()
	mine := e.sessions.GetOrCreateActive("test:ws1")
	other := e.sessions.GetOrCreateActive("test:chat")
	other.SetAgentSessionID("agent-other", "stub")
	other.AddHistory("user", "keep me")

	if _, err := e.QueueSessionReset("test:ws1"); err != nil {
		t.Fatal(err)
	}
	if e.sessions.GetOrCreateActive("test:ws1") == mine {
		t.Fatal("caller's session was not reset")
	}
	if got := e.sessions.GetOrCreateActive("test:chat"); got != other || got.GetAgentSessionID() != "agent-other" || len(got.History) != 1 {
		t.Fatal("another session was touched")
	}
}

func TestSessionResetRejectsBadSession(t *testing.T) {
	e := newTestEngine()
	defer e.Stop()
	if _, err := e.QueueSessionReset(""); err == nil {
		t.Fatal("empty session key must fail")
	}
	if _, err := e.QueueSessionReset("test:nobody"); err == nil {
		t.Fatal("unknown session key must fail")
	}
	if e.sessions.ActiveSessionID("test:nobody") != "" {
		t.Fatal("a failed request must not create a session")
	}

	api := &APIServer{engines: map[string]*Engine{"test": e}}
	for name, tc := range map[string]struct {
		body string
		code int
	}{
		"missing session":   {`{"project":"test","after_turn":true}`, http.StatusBadRequest},
		"missing project":   {`{"session_key":"test:c1","after_turn":true}`, http.StatusBadRequest},
		"wrong project":     {`{"project":"nope","session_key":"test:c1","after_turn":true}`, http.StatusBadRequest},
		"unknown session":   {`{"project":"test","session_key":"test:nobody","after_turn":true}`, http.StatusNotFound},
		"without afterTurn": {`{"project":"test","session_key":"test:c1"}`, http.StatusBadRequest},
	} {
		w := httptest.NewRecorder()
		api.handleSessionNew(w, httptest.NewRequest(http.MethodPost, "/session/new", bytes.NewBufferString(tc.body)))
		if w.Code != tc.code {
			t.Errorf("%s: code %d, want %d (%s)", name, w.Code, tc.code, w.Body.String())
		}
	}
}

// closeHookSession runs onClose while the bridge tears the old conversation
// down, i.e. while the reset holds the session.
type closeHookSession struct {
	events  chan Event
	onClose func()
}

func (s *closeHookSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	return nil
}
func (s *closeHookSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *closeHookSession) Events() <-chan Event                             { return s.events }
func (s *closeHookSession) CurrentSessionID() string                         { return "agent-old" }
func (s *closeHookSession) Alive() bool                                      { return true }
func (s *closeHookSession) Close() error {
	s.onClose()
	return nil
}

// A message that arrives while the reset is closing the old conversation is
// answered by the fresh session, not dropped.
func TestSessionResetKeepsMessageArrivingDuringReset(t *testing.T) {
	const key = "test:c1"
	fresh := newResultAgentSession("fresh reply")
	p := &resetOrderPlatform{stubPlatformEngine: &stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &resultAgent{session: fresh}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	p.active = func() string { return e.sessions.ActiveSessionID(key) }
	old := e.sessions.GetOrCreateActive(key)
	old.SetAgentSessionID("agent-old", "stub")
	oldID := old.ID

	oldAS := &closeHookSession{events: make(chan Event, 1)}
	oldAS.onClose = func() {
		e.handleMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: "late message", ReplyCtx: "ctx"})
	}
	e.interactiveMu.Lock()
	e.interactiveStates[key] = &interactiveState{agentSession: oldAS, platform: p, replyCtx: "ctx", agent: e.agent}
	e.interactiveMu.Unlock()

	r, err := e.QueueSessionReset(key)
	if err != nil || !r.OK || r.Queued {
		t.Fatalf("idle session should reset now: %+v %v", r, err)
	}
	waitFor(t, "late message answered", func() bool { _, ok := p.activeAt("fresh reply"); return ok })
	if at, _ := p.activeAt("fresh reply"); at == oldID {
		t.Fatalf("late message was answered by the old session")
	}
	for _, s := range p.getSent() {
		if strings.Contains(s, "session reset") {
			t.Fatalf("late message was dropped: %q", s)
		}
	}
}

// A reset requested from a cron/timer turn on a side session (which carries
// the main CC_SESSION_KEY) waits until that turn ends.
func TestSessionResetFromSideSessionTurnWaitsForTurn(t *testing.T) {
	const key = "test:c1"
	sess := &resetDuringTurnSession{events: make(chan Event, 4)}
	p := &resetOrderPlatform{stubPlatformEngine: &stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	p.active = func() string { return e.sessions.ActiveSessionID(key) }
	oldID := e.sessions.GetOrCreateActive(key).ID

	var queued SessionResetResult
	var midTurnID string
	sess.onTurn = func() {
		r, err := e.QueueSessionReset(key)
		if err != nil {
			t.Errorf("QueueSessionReset: %v", err)
		}
		queued = r
		midTurnID = e.sessions.ActiveSessionID(key)
	}

	side := e.sessions.NewSideSession(key, "cron-job")
	if !side.TryLock() {
		t.Fatal("lock side session")
	}
	iKey := key + "#cron:" + side.ID
	msg := &Message{SessionKey: key, Platform: "test", UserID: "u", UserName: "u", Content: "cron prompt", ReplyCtx: "ctx"}
	e.processInteractiveMessageWith(p, msg, side, e.agent, e.sessions, iKey, "", key)

	if !queued.OK || !queued.Queued {
		t.Fatalf("request from a running cron turn should be queued, got %+v", queued)
	}
	if midTurnID != oldID {
		t.Fatalf("main session was reset mid-turn: %q -> %q", oldID, midTurnID)
	}
	if e.sessions.ActiveSessionID(key) == oldID {
		t.Fatal("reset did not run after the cron turn ended")
	}
}
