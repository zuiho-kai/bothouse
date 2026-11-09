//go:build windows

package main

import (
	"os/exec"
	"strconv"
	"syscall"

	"golang.org/x/sys/windows"
)

// detachPetProcess lets the pet outlive the `bothouse pet start` that launched it, without a console window.
func detachPetProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
		HideWindow:    true,
	}
}

// stopPetProcess ends the relay and everything it started (cmd shim, node); there is no SIGTERM to
// forward on Windows. dsh-pet's desktop helper notices its host is gone and quits by itself.
func stopPetProcess(pid int) {
	_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid)).Run()
}

func interruptPetChild(child *exec.Cmd) {
	if child.Process != nil {
		_ = child.Process.Kill()
	}
}
