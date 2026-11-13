package claudecode

import (
	"context"
	"github.com/chenhg5/cc-connect/core"
	"testing"
)

// #1562: an api_retry system event (the CLI retrying a failed request) is not agent activity:
// it must not reach the engine, whose last-event time the team watch reads as progress.
func TestAPIRetryIsNotForwarded(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cs := &claudeSession{events: make(chan core.Event, 4), ctx: ctx}
	cs.handleSystem(map[string]any{"type": "system", "subtype": "api_retry", "attempt": 3.0, "error_status": 500.0, "error": "server_error", "session_id": "s-1"})
	if n := len(cs.events); n != 0 {
		t.Fatalf("api_retry forwarded %d events", n)
	}
	if got := cs.CurrentSessionID(); got != "s-1" {
		t.Fatalf("session id %q", got)
	}
	cs.handleSystem(map[string]any{"type": "system", "subtype": "init", "session_id": "s-1"})
	if len(cs.events) != 1 {
		t.Fatal("init with a session id still forwards one event")
	}
}
