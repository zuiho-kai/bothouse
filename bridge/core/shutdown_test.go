package core

import (
	"testing"
	"time"
)

// A permission waiter must leave when the engine stops, even if nobody
// answers the prompt and the agent's event channel closes.
func TestEngine_StopUnblocksPendingPermission(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	key := "test:shutdown-permission"
	session := e.sessions.GetOrCreateActive(key)
	as := newControllableSession("permission-session")
	state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	as.events <- Event{Type: EventPermissionRequest, RequestID: "unanswered", ToolName: "Write"}
	e.startMessageWorker(func() {
		e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, nil)
	})
	var pending *pendingPermission
	deadline := time.Now().Add(time.Second)
	for pending == nil && time.Now().Before(deadline) {
		state.mu.Lock()
		pending = state.pending
		state.mu.Unlock()
		if pending == nil {
			time.Sleep(time.Millisecond)
		}
	}
	if pending == nil {
		e.cancel()
		t.Fatal("permission request was not handled")
	}
	done := make(chan error, 1)
	go func() { done <- e.Stop() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		// Release the old implementation's waiter so the failing test
		// leaves no blocked goroutine behind.
		pending.resolve()
		<-done
		t.Fatal("Stop hung after closing the agent: permission wait ignored cancellation")
	}
}
