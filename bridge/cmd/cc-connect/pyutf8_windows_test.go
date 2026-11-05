//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// A Python child writes and reads the board's UTF-8 text even on a cp936 Windows.
func TestPythonChildUsesUTF8(t *testing.T) {
	py, err := core.FindPython()
	if err != nil {
		t.Skip("no python")
	}
	f := filepath.Join(t.TempDir(), "b.jsonl")
	script := "import sys,pathlib;p=pathlib.Path(sys.argv[1]);p.write_text('⏰ 任务板\\n');print(sys.flags.utf8_mode, p.read_text().strip())"
	out, err := exec.Command(py, "-c", script, f).CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != "1 ⏰ 任务板" {
		t.Fatalf("python child: %q %v", out, err)
	}
	if b, _ := os.ReadFile(f); string(b) != "⏰ 任务板\n" && string(b) != "⏰ 任务板\r\n" {
		t.Fatalf("file is not UTF-8: % x", b)
	}
}
