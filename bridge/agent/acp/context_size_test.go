package acp

import (
	"encoding/json"
	"testing"
)

// Grok's turn_completed usage reaches the Agent as one model call's prompt size.
func TestXAITurnCompletedReportsContextTokens(t *testing.T) {
	a := &Agent{}
	s := &acpSession{callbacks: a}
	update := func(inputTokens, calls int) {
		params, _ := json.Marshal(map[string]any{
			"sessionId": "g1",
			"update": map[string]any{
				"sessionUpdate": "turn_completed",
				"usage":         map[string]any{"inputTokens": inputTokens, "modelCalls": calls},
			},
		})
		s.onNotification(xaiSessionNotification, params)
	}
	update(68807, 1)
	if got := a.LastContextTokens("g1"); got != 68807 {
		t.Fatalf("one call: got %d", got)
	}
	update(84828, 2)
	if got := a.LastContextTokens("g1"); got != 42414 {
		t.Fatalf("two calls: got %d", got)
	}
	if got := a.LastContextTokens("other"); got != 0 {
		t.Fatalf("unknown session: got %d", got)
	}
}
