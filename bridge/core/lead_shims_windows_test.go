//go:build windows

package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A role's PowerShell / cmd runs the lead scripts by name through the .cmd shims.
func TestLeadShimsRunByName(t *testing.T) {
	if _, err := FindPython(); err != nil {
		t.Skip("no python")
	}
	root := t.TempDir()
	lead, gate := filepath.Join(root, "lead"), filepath.Join(root, "gate")
	_ = os.MkdirAll(lead, 0o755)
	_ = os.MkdirAll(gate, 0o755)
	w := func(p, s string) { _ = os.WriteFile(p, []byte(s), 0o755) }
	w(filepath.Join(lead, "ws-up"), "#!/usr/bin/env -S python3 -I\nimport sys\nprint('ws-up', sys.flags.isolated, *sys.argv[1:])\n")
	w(filepath.Join(lead, "board"), "#!/bin/sh\nd=$(cd \"$(dirname \"$0\")\" && pwd)\nexec python3 -I \"${GATE_DIR:-$d/../gate}/board.py\" \"$@\"\n")
	w(filepath.Join(gate, "board.py"), "import sys\nprint('board', *sys.argv[1:])\n")
	w(filepath.Join(lead, "later"), "#!/bin/sh\nset -eu\nhere=$(cd \"$(dirname \"$0\")\" && pwd)\nm=$(python3 -c 'import sys;print(int(sys.argv[1])*2)' \"$1\")\necho \"later $m $2 $(basename \"$here\")\"\n")
	w(filepath.Join(lead, "iso-check"), "#!/bin/zsh\necho hi\n")
	writeLeadShims(lead)
	run := func(shell string, args ...string) string {
		var c *exec.Cmd
		if shell == "ps" {
			c = exec.Command("powershell.exe", append([]string{"-NoProfile", "-Command"}, strings.Join(args, " "))...)
		} else {
			c = exec.Command("cmd.exe", append([]string{"/c"}, args...)...)
		}
		c.Env = append(os.Environ(), "PATH="+lead+";"+os.Getenv("PATH"))
		c.Env = append(c.Env, "GATE_DIR=")
		out, _ := c.CombinedOutput()
		return strings.TrimSpace(string(out))
	}
	if bash, _ := LookBash(); bash != "" {
		// Git Bash finds the extensionless scripts; python3 must be the shim, not the Store stub.
		for cmdline, want := range map[string]string{"ws-up a b": "ws-up 1 a b", "later 21 x": "later 42 x lead", "board list": "board list"} {
			c := exec.Command(bash, "-c", "unset GATE_DIR; "+cmdline)
			c.Env = append(os.Environ(), "PATH="+lead+";"+os.Getenv("PATH"))
			out, _ := c.CombinedOutput()
			if got := strings.TrimSpace(string(out)); got != want {
				t.Errorf("git bash %s: %q", cmdline, got)
			}
		}
	}
	for _, sh := range []string{"cmd", "ps"} {
		if got := run(sh, "ws-up", "a", "b"); got != "ws-up 1 a b" {
			t.Errorf("%s ws-up: %q", sh, got)
		}
		if got := run(sh, "board", "list"); got != "board list" {
			t.Errorf("%s board: %q", sh, got)
		}
		if bash, _ := LookBash(); bash != "" {
			if got := run(sh, "later", "21", "x"); got != "later 42 x lead" {
				t.Errorf("%s later: %q", sh, got)
			}
		}
		if got := run(sh, "iso-check"); !strings.Contains(got, "needs zsh") {
			t.Errorf("%s iso-check: %q", sh, got)
		}
	}
}
