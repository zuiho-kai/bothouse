package codex

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// PATH lacks codex; a fake one sits in <HOME>/.local/bin. New keeps its absolute path and the
// app-server session starts that file, not a bare "codex".
func TestNew_FindsCodexOutsidePATHAndAppServerStartsIt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix install dirs")
	}
	home := t.TempDir()
	bin := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "started")
	fake := filepath.Join(bin, "codex")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho \"$@\" > '"+marker+"'\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PATH", "/usr/bin:/bin") // sh only; no codex

	ag, err := New(map[string]any{"work_dir": t.TempDir(), "backend": "app_server", "codex_home": t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	a := ag.(*Agent)
	if a.cmd != fake {
		t.Fatalf("cmd = %q, want %q", a.cmd, fake)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if s, err := newAppServerSession(ctx, a.cmd, "", t.TempDir(), "", "", "", "", "", "", nil, "", "", "", "", ""); err == nil {
		_ = s.Close()
		t.Fatal("fake codex exits at once; session start should fail")
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("the found codex was not started: %v", err)
	}
}
