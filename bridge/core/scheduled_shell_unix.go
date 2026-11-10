//go:build !windows

package core

import "os/exec"

// Reuse the wizard's existing process-group cancellation for scheduled shells.
func ownScheduledShell(cmd *exec.Cmd) { ownProcessGroup(cmd) }
