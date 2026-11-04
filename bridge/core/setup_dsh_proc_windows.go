//go:build windows

package core

import (
	"os"
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// detach starts `dsh web` in its own process group without a console so it outlives the wizard.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x08000000} // CREATE_NO_WINDOW (Win32 docs)
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(handle)
	// A live process is nonsignaled. Polling also handles a process that exited
	// with code 259 (STILL_ACTIVE), without confusing its exit code with liveness.
	status, err := windows.WaitForSingleObject(handle, 0)
	return err == nil && status == uint32(windows.WAIT_TIMEOUT)
}

func stopProcess(pid int) {
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Kill()
	}
}

// ownProcessGroup: Windows has no process groups to kill this way; the context kills pnpm.
func ownProcessGroup(cmd *exec.Cmd) {}
