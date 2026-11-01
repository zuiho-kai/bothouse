package codex

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetModelUsesCurrentRollout(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, "sessions", "2026", "10", "23")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	id := "00000000-0000-0000-0000-000000000001"
	path := filepath.Join(dir, "rollout-2026-10-23-"+id+".jsonl")
	header := `{"type":"session_meta","payload":{"id":"` + id + `"}}` + "\n"
	write := func(body string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(header+body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	cs, err := newCodexSession(context.Background(), "missing-codex", nil, t.TempDir(), "", "", "suggest", id, "", []string{"CODEX_HOME=" + home}, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	write(`{"type":"turn_context","payload":{"model":"actual-first"}}` + "\n")
	if got := cs.GetModel(); got != "actual-first" {
		t.Fatalf("default model = %q", got)
	}
	// The same live session must observe a later turn, not cache the first model.
	write(`{"type":"turn_context","payload":{"model":"actual-first"}}` + "\n" + `{"type":"turn_context","payload":{"model":"actual-latest"}}` + "\n" + `{"type":"turn_context","payload":`)
	if got := cs.GetModel(); got != "actual-latest" {
		t.Fatalf("latest model = %q", got)
	}
	// Huge tool output after the turn must not hide its model or overflow scanning.
	write(`{"type":"turn_context","payload":{"model":"actual-large"}}` + "\n" + strings.Repeat("x", 3<<20) + "\n")
	if got := cs.GetModel(); got != "actual-large" {
		t.Fatalf("large rollout = %q", got)
	}
	write(strings.Repeat("x", 3<<20) + "\n" + `{"type":"turn_context","payload":{"model":"actual-tail"}}` + "\n")
	if got := cs.GetModel(); got != "actual-tail" {
		t.Fatalf("tail model = %q", got)
	}
	// Fresh sessions learn their id from thread.started, after construction.
	cs.threadID.Store("")
	cs.model = "configured-fallback"
	if got := cs.GetModel(); got != "configured-fallback" {
		t.Fatalf("before first turn = %q", got)
	}
	cs.threadID.Store(id)
	if got := cs.GetModel(); got != "actual-tail" {
		t.Fatalf("runtime model must win over configuration = %q", got)
	}
	// A filename match is insufficient: never borrow another session's model.
	header = `{"type":"session_meta","payload":{"id":"different-session"}}` + "\n"
	write(`{"type":"turn_context","payload":{"model":"wrong-session"}}` + "\n")
	cs.model = "configured-fallback"
	if got := cs.GetModel(); got != "configured-fallback" {
		t.Fatalf("session isolation = %q", got)
	}
}
