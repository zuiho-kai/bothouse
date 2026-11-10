//go:build !windows

package core

import "os/exec"

func runPluginUninstallCommand(cmd *exec.Cmd) error {
	// This is the helper's independent process group, not the bridge's group.
	ownProcessGroup(cmd)
	return cmd.Run()
}
