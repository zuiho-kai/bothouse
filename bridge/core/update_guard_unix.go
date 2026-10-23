//go:build !windows

package core

import (
	"os"
	"os/exec"
	"syscall"
)

// detachCmd: own session, so the guard outlives the restart and launchd's process-group cleanup.
func detachCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

// restartOld replaces this process with the old binary, same arguments (same PID, so a
// supervisor such as systemd keeps tracking it).
var restartOld = func(exe string, args []string) error { return execOld(syscall.Exec, exe, args) }

func execOld(execve func(string, []string, []string) error, exe string, args []string) error {
	return execve(exe, append([]string{exe}, args...), os.Environ())
}
