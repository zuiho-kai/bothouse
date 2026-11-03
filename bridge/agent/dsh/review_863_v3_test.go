package dsh

import (
	"path/filepath"
	"strings"
	"testing"
)

// Independent review uses the existing compressed fixture writer, including a torn final frame.
func TestReview863CompressedV3Context(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, "sessions", "--review--", "review-v3", "session.v3.jsonl.zstd")
	fixture := append([]string(nil), handoffFixture...)
	for i := range fixture {
		fixture[i] = strings.ReplaceAll(fixture[i], "40600", "180000")
	}
	writeZstdLog(t, path, fixture)
	h, err := readHandoff(home, "review-v3")
	if err != nil {
		t.Fatal(err)
	}
	if h.Path != path || h.ContextTokens != 180300 || len(h.Tail) != 5 {
		t.Fatalf("v3 compressed handoff path=%s context=%d tail=%d", h.Path, h.ContextTokens, len(h.Tail))
	}
	t.Logf("v3 zstd context=%d, expected above configured 80000 threshold; tail=%d", h.ContextTokens, len(h.Tail))
}
