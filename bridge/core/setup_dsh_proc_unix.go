//go:build !windows

package core

import (
	"os/exec"
	"syscall"
)

// detach puts `dsh web` in its own session so it outlives the wizard and its terminal.
func detach(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }

func processAlive(pid int) bool { return syscall.Kill(pid, 0) == nil }

func stopProcess(pid int) { _ = syscall.Kill(pid, syscall.SIGTERM) }

// ownProcessGroup starts cmd in its own process group and makes the context cancel kill the
// whole group.
func ownProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}
