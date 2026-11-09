//go:build windows

package codex

import (
	"os/exec"
	"syscall"
	"testing"
)

// The app-server child must never get its own console: the bridge runs as a
// GUI-subsystem binary, so Windows would otherwise allocate a console window
// for codex.exe and closing that window would kill the session (issue #477).
func TestPrepareAppServerCmd_NoConsoleWindow(t *testing.T) {
	cmd := exec.Command("codex", "app-server")
	prepareAppServerCmd(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr is nil: the app-server child would inherit/allocate a console")
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatalf("CreationFlags=%#x missing CREATE_NO_WINDOW (%#x)", cmd.SysProcAttr.CreationFlags, createNoWindow)
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow is false: the console window would still be shown")
	}
	if cmd.SysProcAttr.CreationFlags&syscall.CREATE_NEW_PROCESS_GROUP != 0 {
		t.Fatalf("CreationFlags=%#x should not join a new process group (app-server is not killed as a group)", cmd.SysProcAttr.CreationFlags)
	}
}

// The exec path must keep its own flags: the fix is Windows console windows
// for the app-server child only, not a behaviour change for exec turns.
func TestPrepareCmdForKill_LeavesExecFlags(t *testing.T) {
	cmd := exec.Command("codex", "exec", "hello")
	prepareCmdForKill(cmd)
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.CreationFlags&syscall.CREATE_NEW_PROCESS_GROUP == 0 {
		t.Fatalf("exec path lost CREATE_NEW_PROCESS_GROUP: %+v", cmd.SysProcAttr)
	}
}

func TestPrepareAppServerCmd_NilSafe(t *testing.T) {
	prepareAppServerCmd(nil) // must not panic
}
