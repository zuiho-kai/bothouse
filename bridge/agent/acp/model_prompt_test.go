package acp

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSend_ModelSkillReachesNewAndResumedTurns(t *testing.T) {
	s, responses, requests := newTestSession(t, nil)
	seen := make(chan string, 2)
	go func() {
		dec := json.NewDecoder(requests)
		enc := json.NewEncoder(responses)
		for i := 0; i < 2; i++ {
			var req struct {
				ID     json.RawMessage
				Method string
				Params struct {
					SessionID string
					Prompt    []struct{ Type, Text string }
				}
			}
			if err := dec.Decode(&req); err != nil {
				return
			}
			if req.Method != "session/prompt" || req.Params.SessionID != "test-session-id" || len(req.Params.Prompt) != 1 {
				return
			}
			seen <- req.Params.Prompt[0].Text
			if err := enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"stopReason": "end_turn"}}); err != nil {
				return
			}
		}
	}()
	// Grok and DeepSeek share this ACP transport. Explicit progress commands
	// must survive both a fresh prompt and the next prompt of the same session.
	for _, user := range []string{"[Public progress channel] cc-connect progress --run fresh --seq 1 --kind start\n检查绑定", "[Public progress channel] cc-connect progress --run renewed --seq 1 --kind start\n继续检查"} {
		done := make(chan error, 1)
		go func() { done <- s.Send(user, "test", nil, nil) }()
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("ACP prompt did not complete")
		}
		got := <-seen
		if !strings.Contains(got, "model list --json") || !strings.Contains(got, "CC_SESSION_KEY") || !strings.HasSuffix(got, user) {
			t.Fatalf("model skill or user content missing from actual ACP wire payload: %s", got)
		}
	}
}
