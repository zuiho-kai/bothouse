package codex

import (
	"encoding/json"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// A steered parent can launch children in the same app-server process. Child
// lifecycle notifications must not end or replace the platform's active turn.
func TestAppServerSession_ChildEventsPreserveParentReply(t *testing.T) {
	for _, child := range []struct{ method, params string }{
		{"thread/status/changed", `{"threadId":"child","status":{"type":"idle"}}`},
		{"turn/started", `{"threadId":"child","turn":{"id":"child-turn"}}`},
		{"turn/completed", `{"threadId":"child","turn":{"id":"child-turn","status":"completed"}}`},
		{"item/completed", `{"threadId":"child","turnId":"child-turn","item":{"type":"agentMessage","text":"child private result"}}`},
		{"error", `{"threadId":"child","turnId":"child-turn","error":{"message":"child failed"},"willRetry":false}`},
	} {
		t.Run(child.method, func(t *testing.T) {
			s := &appServerSession{events: make(chan core.Event, 8), currentTurn: "parent-turn"}
			s.threadID.Store("parent")
			s.handleNotification(child.method, json.RawMessage(child.params))
			if s.currentTurn != "parent-turn" || len(s.events) != 0 || len(s.pendingMsgs) != 0 {
				t.Fatalf("child event changed parent: turn=%q events=%d pending=%d", s.currentTurn, len(s.events), len(s.pendingMsgs))
			}
			s.handleNotification("item/completed", json.RawMessage(`{"threadId":"parent","turnId":"parent-turn","item":{"type":"agentMessage","text":"I received the inserted request and finished the work."}}`))
			s.handleNotification("turn/completed", json.RawMessage(`{"threadId":"parent","turn":{"id":"parent-turn","status":"completed"}}`))
			if len(s.events) != 2 {
				t.Fatalf("want parent reply and result, got %d events", len(s.events))
			}
			text, result := <-s.events, <-s.events
			if text.Type != core.EventText || text.Content != "I received the inserted request and finished the work." || result.Type != core.EventResult || result.SessionID != "parent" {
				t.Fatalf("parent reply lost or polluted: text=%+v result=%+v", text, result)
			}
		})
	}
}
