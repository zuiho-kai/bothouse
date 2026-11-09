//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// detachPetProcess lets the pet outlive the `bothouse pet start` that launched it.
func detachPetProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

// stopPetProcess asks the relay to stop; it forwards the interrupt to dsh-pet.
func stopPetProcess(pid int) {
	_ = syscall.Kill(pid, syscall.SIGTERM)
}

// interruptPetChild is dsh-pet's Ctrl+C.
func interruptPetChild(child *exec.Cmd) {
	if child.Process != nil {
		_ = child.Process.Signal(syscall.SIGINT)
	}
}
