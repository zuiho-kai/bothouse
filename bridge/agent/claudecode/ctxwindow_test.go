package claudecode

import (
	"strings"
	"testing"
)

func TestResultContextWindowAndAutoCompactPoint(t *testing.T) {
	raw := map[string]any{"modelUsage": map[string]any{
		"claude-opus-5-5":  map[string]any{"contextWindow": float64(1000000)},
		"claude-haiku-5-5": map[string]any{"contextWindow": float64(200000)},
	}}
	if w := resultContextWindow(raw); w != 1000000 {
		t.Fatalf("window = %d", w)
	}
	if w := resultContextWindow(map[string]any{}); w != 0 {
		t.Fatalf("no modelUsage: window = %d", w)
	}
	line := `{"type":"system","subtype":"compact_boundary","uuid":"u1","compactMetadata":{"trigger":"auto","preTokens":167551,"postTokens":10054}}` + "\n"
	h, err := parseHandoff(strings.NewReader(line))
	if err != nil || h.AutoCompactTokens != 167551 || h.ContextTokens != 10054 {
		t.Fatalf("handoff = %+v, err %v", h, err)
	}
	manual := strings.Replace(line, `"auto"`, `"manual"`, 1)
	if h, _ := parseHandoff(strings.NewReader(manual)); h.AutoCompactTokens != 0 {
		t.Fatalf("manual compaction must not count: %d", h.AutoCompactTokens)
	}
}
