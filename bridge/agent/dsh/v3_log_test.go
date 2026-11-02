package dsh

import (
	"os"
	"path/filepath"
	"testing"
)

// An older DSH writes session.v3.jsonl only (QQ 肥鱼, 2026-11-02); the context size is still read.
func TestReadHandoff_V3Log(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, "sessions", "--w--", "s1")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	log := `{"type":"turn/start","time":1793634000000,"data":{}}
{"type":"assistant/message","time":1793634029029,"data":{"message":{"role":"assistant","content":[{"type":"text","text":"好"}]},"usage":{"inputTokens":7741,"cacheReadTokens":180000}}}
`
	if err := os.WriteFile(filepath.Join(dir, "session.v3.jsonl"), []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	h, err := readHandoff(home, "s1")
	if err != nil {
		t.Fatal(err)
	}
	if h.ContextTokens != 187741 {
		t.Fatalf("context tokens = %d, want 187741", h.ContextTokens)
	}
}
