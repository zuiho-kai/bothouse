//go:build windows

package core

import (
	"errors"
	"os/exec"
	"testing"
)

// Windows: no exec(2) — start the old binary with the same arguments, then exit 0; a failed
// start returns the error and does not exit.
func TestStartOldThenExit(t *testing.T) {
	var started *exec.Cmd
	code := -1
	err := startOldThenExit(func(c *exec.Cmd) error { started = c; return nil }, func(c int) { code = c }, `C:\b\bothouse.exe`, []string{"--config", "c"})
	if err != nil || started == nil || started.Path != `C:\b\bothouse.exe` || len(started.Args) != 3 || code != 0 {
		t.Fatalf("cmd=%v code=%d err=%v", started, code, err)
	}
	code = -1
	if err := startOldThenExit(func(*exec.Cmd) error { return errors.New("no") }, func(c int) { code = c }, "x", nil); err == nil || code != -1 {
		t.Fatalf("err=%v code=%d", err, code)
	}
}
