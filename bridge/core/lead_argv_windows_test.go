//go:build windows

package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// On Windows the bridge starts lead scripts through the interpreter, not by exec'ing the
// extensionless file (which Windows refuses).
func TestWindowsLeadArgvRunsScripts(t *testing.T) {
	py, err := FindPython()
	if err != nil {
		t.Skip("no python on this machine")
	}
	root := t.TempDir()
	lead := filepath.Join(root, "lead")
	gate := filepath.Join(root, "gate")
	_ = os.MkdirAll(lead, 0o755)
	_ = os.MkdirAll(gate, 0o755)
	write := func(p, s string) {
		if err := os.WriteFile(p, []byte(s), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(lead, "ws-up"), "#!/usr/bin/env -S python3 -I\nimport sys\nprint('ws-up', sys.flags.isolated, *sys.argv[1:])\n")
	write(filepath.Join(lead, "lead"), "#!/usr/bin/env python3\nimport sys\nprint('lead', sys.flags.isolated)\n")
	write(filepath.Join(lead, "board"), "#!/bin/sh\nexec python3 -I \"${GATE_DIR:-$d/../gate}/board.py\" \"$@\"\n")
	write(filepath.Join(gate, "board.py"), "import sys\nprint('board', *sys.argv[1:])\n")
	write(filepath.Join(lead, "later"), "#!/bin/sh\necho later\n")

	if _, err := exec.Command(filepath.Join(lead, "ws-up")).CombinedOutput(); err == nil {
		t.Fatal("expected Windows to refuse the extensionless script (the bug this guards)")
	}
	for name, want := range map[string]string{"ws-up": "ws-up 1 a b", "lead": "lead 0", "board": "board a b"} {
		argv, err := windowsLeadArgv(filepath.Join(lead, name), py)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		args := argv[1:]
		if name != "lead" {
			args = append(args, "a", "b")
		}
		out, err := exec.Command(argv[0], args...).CombinedOutput()
		if err != nil || strings.TrimSpace(string(out)) != want {
			t.Fatalf("%s: %q %v, want %q", name, out, err, want)
		}
	}
	if _, err := windowsLeadArgv(filepath.Join(lead, "later"), py); err == nil {
		t.Fatal("later is a shell script: expected a clear error")
	}
}
