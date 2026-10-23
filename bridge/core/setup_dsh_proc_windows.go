//go:build windows

package core

import (
	"os"
	"os/exec"
	"syscall"
)

// detach starts `dsh web` in its own process group without a console so it outlives the wizard.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x08000000} // CREATE_NO_WINDOW (Win32 docs)
}

func processAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return p.Signal(syscall.Signal(0)) == nil
}

func stopProcess(pid int) {
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Kill()
	}
}

// ownProcessGroup: Windows has no process groups to kill this way; the context kills pnpm.
func ownProcessGroup(cmd *exec.Cmd) {}
