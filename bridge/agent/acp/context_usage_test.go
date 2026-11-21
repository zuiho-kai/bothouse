package acp

import (
	"encoding/json"
	"testing"
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
