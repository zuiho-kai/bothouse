package acp

import (
	"encoding/json"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestUsageUpdateReportsCurrentContext(t *testing.T) {
	a := &Agent{}
	s := &acpSession{acpSessID: "active", callbacks: a}
	if s.GetContextUsage() != nil || a.ReadContextUsage("active") != nil {
		t.Fatal("unreported context must remain unknown")
	}
	update := func(id string, used, size int) {
		raw, _ := json.Marshal(map[string]any{
			"sessionId": id, "update": map[string]any{
				"sessionUpdate": "usage_update", "used": used, "size": size,
				"cost":  map[string]any{"amount": 900000, "currency": "USD"},
				"_meta": map[string]any{"cognition.ai/inputTokens": 800000},
			},
		})
		s.onNotification("session/update", raw)
	}
	// Actual isolated Devin response, cross-checked with /context's 4.4%.
	update("active", 11418, 262000)
	u := s.GetContextUsage()
	if u == nil || u.UsedTokens != 11418 || u.ContextWindow != 262000 || u.InputTokens != 0 {
		t.Fatalf("current context snapshot missing or derived from cumulative usage: %+v", u)
	}
	if a.LastContextTokens("active") != 11418 || s.ReportedContextWindow() != 262000 {
		t.Fatal("context size/window did not reach existing readers")
	}
	update("another-session", 250000, 262000)
	s.onNotification("session/update", json.RawMessage(`{"sessionId":"active","update":{"sessionUpdate":"usage_update","size":262000}}`))
	if a.ReadContextUsage("another-session") != nil || s.GetContextUsage().UsedTokens != 11418 {
		t.Fatal("unrelated session or incomplete snapshot replaced current usage")
	}
	// Snapshots can shrink after compaction, including an explicitly empty context.
	update("active", 0, 262000)
	if a.ReadContextUsage("active").UsedTokens != 0 || s.GetContextUsage().UsedTokens != 0 || a.LastContextTokens("active") != 0 {
		t.Fatal("snapshot retained the pre-compaction high watermark")
	}
	u = a.ReadContextUsage("active")
	u.UsedTokens = 123
	if a.ReadContextUsage("active").UsedTokens != 0 {
		t.Fatal("caller mutated the stored context snapshot")
	}
}

// Shapes captured from an isolated `devin acp` 3000.14 turn: usage_update first,
// then the session/prompt response carrying the turn's usage.
func TestPromptResultCarriesTurnUsage(t *testing.T) {
	a := &Agent{}
	s, responses, requests := newTestSession(t, a)
	go func() {
		dec, enc := json.NewDecoder(requests), json.NewEncoder(responses)
		var req inputRPCRequest
		if dec.Decode(&req) != nil {
			return
		}
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
			"sessionId": "test-session-id", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "hi"}},
		}})
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
			"sessionId": "test-session-id", "update": map[string]any{"sessionUpdate": "usage_update", "used": 20660, "size": 262000},
		}})
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{
			"stopReason": "end_turn",
			"usage":      map[string]any{"totalTokens": 20660, "inputTokens": 20632, "outputTokens": 28, "cachedReadTokens": 20608},
		}})
	}()
	if err := s.Send("hi", "m", nil, nil); err != nil {
		t.Fatal(err)
	}
	var result *core.Event
	for len(s.events) > 0 {
		if ev := <-s.events; ev.Type == core.EventResult {
			result = &ev
		}
	}
	if result == nil || !result.UsageKnown || result.InputTokens != 24 || result.OutputTokens != 28 || result.CacheReadInputTokens != 20608 {
		t.Fatalf("turn usage missing from result: %+v", result)
	}
	u := s.GetContextUsage()
	if u == nil || u.UsedTokens != 20660 || u.ContextWindow != 262000 || u.InputTokens != 24 || u.OutputTokens != 28 || u.CachedInputTokens != 20608 {
		t.Fatalf("footer snapshot missing turn usage: %+v", u)
	}
	if got := a.ReadContextUsage("test-session-id"); got == nil || got.OutputTokens != 28 {
		t.Fatalf("agent snapshot missing turn usage: %+v", got)
	}
}
