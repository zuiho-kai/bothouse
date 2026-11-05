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

// processAlive asks Windows for the process state. Signal(0) is not supported on
// Windows (os: "not supported by windows"), so it always reported the DSH web
// process as dead and the /dsh proxy answered 503.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	const processQueryLimitedInformation = 0x1000 // PROCESS_QUERY_LIMITED_INFORMATION (Win32 docs)
	const stillActive = 259                       // STILL_ACTIVE (Win32 docs)
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		// The process exists but belongs to someone we may not query (e.g. elevated).
		return err == syscall.ERROR_ACCESS_DENIED
	}
	defer syscall.CloseHandle(h)
	var code uint32
	if err := syscall.GetExitCodeProcess(h, &code); err != nil {
		return false
	}
	return code == stillActive
}

func stopProcess(pid int) {
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Kill()
	}
}

// ownProcessGroup: Windows has no process groups to kill this way; the context kills pnpm.
func ownProcessGroup(cmd *exec.Cmd) {}
