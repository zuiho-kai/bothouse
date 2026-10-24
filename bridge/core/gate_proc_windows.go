//go:build windows

package core

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps python.exe from opening a console window next to bothouse.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW (Win32 docs)
}
