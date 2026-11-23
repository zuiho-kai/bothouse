package acp

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSend_ModelSkillOncePerAgentSession(t *testing.T) {
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
	// #1899: the model skill rides only the first prompt of an agent session;
	// repeating it every turn buried the user's question.
	for i, user := range []string{"[Public progress channel] bothouse progress --run fresh --seq 1 --kind start\n检查绑定", "[Public progress channel] bothouse progress --run renewed --seq 1 --kind start\n继续检查"} {
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
		hasSkill := strings.Contains(got, "model list --json") && strings.Contains(got, "CC_SESSION_KEY")
		if hasSkill != (i == 0) || !strings.HasSuffix(got, user) {
			t.Fatalf("prompt %d: model skill present = %v (want %v) or user content missing from ACP wire payload: %s", i+1, hasSkill, i == 0, got)
		}
	}
}
