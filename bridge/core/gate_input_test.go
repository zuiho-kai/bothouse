package core

import "testing"

// A local voice turn must not absorb Discord text via mid-turn injection.
func TestInjectIntoRunningTurnSkipsLocalInputTurn(t *testing.T) {
	e := newTestEngine()
	as := newCodexLikeSession("thread-1")
	state := &interactiveState{agentSession: as}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = state
	e.interactiveMu.Unlock()

	state.localInputOnly = &inputTurn{expectedID: "thread-1"}
	if e.injectIntoRunningTurn("k", "hi", nil, nil) || as.hasSentID {
		t.Fatal("injected into a local input turn")
	}
	state.localInputOnly = nil
	if !e.injectIntoRunningTurn("k", "hi", nil, nil) || !as.hasSentID {
		t.Fatal("ordinary turn no longer accepts injection")
	}
}
