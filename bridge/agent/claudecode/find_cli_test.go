package claudecode

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// PATH lacks the CLI; a fake claude sits in <HOME>/.local/bin: the adapter starts and keeps its absolute path.
func TestNew_FindsClaudeOutsidePATH(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix install dirs")
	}
	home := t.TempDir()
	bin := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	fake := filepath.Join(bin, "claude")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PATH", t.TempDir())

	ag, err := New(map[string]any{"work_dir": t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got := ag.(*Agent).CLIBinaryName(); got != fake {
		t.Fatalf("cmd = %q, want %q", got, fake)
	}
}
