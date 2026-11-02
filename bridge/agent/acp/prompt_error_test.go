package acp

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Send errors race with Events in Engine. Once a prompt has an ordered event
// stream, its terminal RPC failure must use that stream as its only outcome.
func TestPromptError_OnlyTerminalEventAfterTool(t *testing.T) {
	for _, strict := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "strict"}[strict], func(t *testing.T) {
			s, responses, requests := newTestSession(t, nil)
			go func() {
				var req inputRPCRequest
				if json.NewDecoder(requests).Decode(&req) != nil {
					return
				}
				enc := json.NewEncoder(responses)
				_ = enc.Encode(inputUpdate("test-session-id", "first-attempt-text"))
				_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
					"sessionId": "test-session-id", "update": map[string]any{"sessionUpdate": "tool_call", "toolCallId": "fixture-tool", "title": "fixture-tool", "status": "in_progress"},
				}})
				_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32603, "message": "Selected model is at capacity. Please try a different model."}})
			}()
			done := make(chan error, 1)
			go func() {
				if strict {
					done <- s.SendResumed("test", "m", nil, nil, "test-session-id")
				} else {
					done <- s.Send("test", "m", nil, nil)
				}
			}()
			select {
			case err := <-done:
				if err != nil {
					t.Fatalf("ordered prompt failure also returned by Send: %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("prompt timed out")
			}
			var kinds []core.EventType
			for len(s.events) > 0 {
				event := <-s.events
				kinds = append(kinds, event.Type)
				if event.Type == core.EventError && !strings.Contains(event.Error.Error(), "at capacity") {
					t.Fatalf("wrong terminal failure: %+v", event)
				}
			}
			if len(kinds) != 3 || kinds[0] != core.EventText || kinds[1] != core.EventToolUse || kinds[2] != core.EventError {
				t.Fatalf("event order = %v", kinds)
			}
		})
	}
}
