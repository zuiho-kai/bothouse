//go:build !windows

package core

import "os/exec"

// hideWindow: nothing to hide outside Windows.
func hideWindow(cmd *exec.Cmd) {}
