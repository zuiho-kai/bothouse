//go:build windows

package core

import (
	"os/exec"
	"sync"
)

// Reuse the existing Windows taskkill /T implementation; killing PowerShell
// alone leaves Python and its model process holding the wiki lock.
func ownScheduledShell(cmd *exec.Cmd) {
	var once sync.Once
	cmd.Cancel = func() error {
		once.Do(func() { stopProcess(cmd.Process.Pid) })
		return nil
	}
}
