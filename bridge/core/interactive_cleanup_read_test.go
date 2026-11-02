package core

import (
	"testing"
	"time"
)

// The workspace watcher can finish cleanup before a resumed turn starts reading
// events. Source: TestWatchStartedFires race between cleanup and event reading.
func TestProcessInteractiveEventsAfterWorkspaceCleanup(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("cleanup", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(e.cancel)
	key := "test:cleaned-workspace"
	session := e.sessions.GetOrCreateActive(key)
	state := &interactiveState{agentSession: newControllableSession("cleaned"), platform: p, replyCtx: key}
	e.interactiveStates[key] = state
	e.cleanupInteractiveState(key, state)
	e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, key)
}
