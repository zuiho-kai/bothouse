//go:build windows

package core

import (
	"os"
	"os/exec"
	"syscall"
)

// detachCmd: DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, so the guard survives the console
// supervisor and gets no console of its own.
func detachCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200}
}

// restartOld: Windows has no exec(2), so start the old binary with the same arguments and
// standard streams, then exit; the service script / console sees the old binary running.
var restartOld = func(exe string, args []string) error {
	return startOldThenExit(func(c *exec.Cmd) error { return c.Start() }, os.Exit, exe, args)
}

func startOldThenExit(start func(*exec.Cmd) error, exit func(int), exe string, args []string) error {
	cmd := exec.Command(exe, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := start(cmd); err != nil {
		return err
	}
	exit(0)
	return nil
}
