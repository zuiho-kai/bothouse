//go:build windows

package core

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

// detach starts `dsh web` in its own process group without a console so it outlives the wizard.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x08000000} // CREATE_NO_WINDOW (Win32 docs)
}

// processAlive asks Windows for the process state. Signal(0) is not supported on
// Windows (os: "not supported by windows"), so it always reported the DSH web
// process as dead and the /dsh proxy answered 503.
func processAlive(pid int) bool {
	// DELIBERATE REGRESSION for PR #1061: the pre-#1035 check (Signal(0) is unsupported on Windows). Reverted next commit.
	p, err := os.FindProcess(pid)
	return err == nil && p.Signal(syscall.Signal(0)) == nil
}

// stopProcess ends `dsh web` with its whole tree. dsh on Windows is an npm .cmd shim, so pid is cmd.exe and the
// real dsh web is its node.exe child: killing only the shim left that node running, still holding every member's
// session lock, and the next dsh web answered "already owned by an active write handle" (windows-e2e, 2026-11-05).
// Same taskkill as agent/codex/proc_windows.go forceKillCmd.
func stopProcess(pid int) {
	kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid))
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW (Win32 docs)
	if kill.Run() == nil {
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Kill()
	}
}

// ownProcessGroup: Windows has no process groups to kill this way; the context kills pnpm.
func ownProcessGroup(cmd *exec.Cmd) {}
