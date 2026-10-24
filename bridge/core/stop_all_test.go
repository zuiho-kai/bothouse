package core

import (
	"testing"
)

func TestIsStopAllCommand(t *testing.T) {
	for _, s := range []string{"/stop all", " /stop  all ", "/STOP ALL"} {
		if !IsStopAllCommand(s) {
			t.Errorf("IsStopAllCommand(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"/stop", "stop all", "/stop all now", "/stopall", "/stop everything"} {
		if IsStopAllCommand(s) {
			t.Errorf("IsStopAllCommand(%q) = true, want false", s)
		}
	}
}

type stopAllFixture struct {
	sess    map[string]*abortTurnSession
	pending map[string]*pendingPermission
}

// addBusyState registers a running turn with a pending permission request.
func addBusyState(e *Engine, f *stopAllFixture, key string) {
	s := &abortTurnSession{events: make(chan Event, 8)}
	pp := &pendingPermission{RequestID: "req-" + key, Resolved: make(chan struct{})}
	e.interactiveStates[key] = &interactiveState{agentSession: s, pending: pp}
	f.sess[e.name+"|"+key] = s
	f.pending[e.name+"|"+key] = pp
}

func (f *stopAllFixture) stopped(t *testing.T, id string) bool {
	t.Helper()
	s := f.sess[id]
	s.mu.Lock()
	cancels := s.cancels
	s.mu.Unlock()
	resolved := false
	select {
	case <-f.pending[id].Resolved:
		resolved = true
	default:
	}
	if (cancels > 0) != resolved {
		t.Fatalf("%s: cancels=%d resolved=%v, want both or neither", id, cancels, resolved)
	}
	return cancels > 0
}

// Two bots share a channel; "/stop all" without a mention stops both bots'
// turns there and releases their pending approvals, other channels keep going.
func TestStopAllStopsEveryBotInChannel(t *testing.T) {
	f := &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
	pa := &stubPlatformEngine{n: "test"}
	pb := &stubPlatformEngine{n: "test"}
	a := NewEngine("bot-a", &stubAgent{}, []Platform{pa}, "", LangEnglish)
	b := NewEngine("bot-b", &stubAgent{}, []Platform{pb}, "", LangEnglish)
	defer a.Stop()
	defer b.Stop()

	addBusyState(a, f, "test:room1:u1")
	addBusyState(a, f, "/ws/proj:test:room1:u2") // workspace-prefixed key
	addBusyState(a, f, "test:room2:u1")
	addBusyState(b, f, "test:room1:u1")
	addBusyState(b, f, "test:room2:u1")

	for _, pair := range []struct {
		e *Engine
		p Platform
	}{{a, pa}, {b, pb}} {
		pair.e.handleMessage(pair.p, &Message{SessionKey: "test:room1:u1", Platform: "test", MessageID: "m1",
			UserID: "u1", UserName: "user", Content: "/stop all", ReplyCtx: "ctx"})
	}

	for _, id := range []string{"bot-a|test:room1:u1", "bot-a|/ws/proj:test:room1:u2", "bot-b|test:room1:u1"} {
		if !f.stopped(t, id) {
			t.Errorf("%s not stopped", id)
		}
	}
	for _, id := range []string{"bot-a|test:room2:u1", "bot-b|test:room2:u1"} {
		if f.stopped(t, id) {
			t.Errorf("%s in another channel was stopped", id)
		}
	}
	if got := pa.getSent(); len(got) != 1 {
		t.Errorf("bot-a replies = %#v, want one confirmation", got)
	}
}

// A bot message saying "/stop all" must not stop anything.
func TestStopAllIgnoresBots(t *testing.T) {
	f := &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("bot-a", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	addBusyState(e, f, "test:room1:u1")
	e.handleMessage(p, &Message{SessionKey: "test:room1:bot", Platform: "test", MessageID: "m1",
		UserID: "bot", FromBot: true, Content: "/stop all", ReplyCtx: "ctx"})
	if f.stopped(t, "bot-a|test:room1:u1") {
		t.Fatal("bot message stopped a session")
	}
}

// Plain /stop keeps its single-session behaviour.
func TestStopSingleSessionUnchanged(t *testing.T) {
	f := &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("bot-a", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	addBusyState(e, f, "test:room1:u1")
	addBusyState(e, f, "test:room1:u2")
	e.handleMessage(p, &Message{SessionKey: "test:room1:u1", Platform: "test", MessageID: "m1",
		UserID: "u1", UserName: "user", Content: "/stop", Mentioned: true, ReplyCtx: "ctx"})
	if !f.stopped(t, "bot-a|test:room1:u1") {
		t.Fatal("/stop did not stop the caller's session")
	}
	if f.stopped(t, "bot-a|test:room1:u2") {
		t.Fatal("/stop stopped another user's session")
	}
}
