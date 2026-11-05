//go:build windows

package main

import (
	"errors"
	"os/exec"
)

// setRunAsUser: switching users needs a Unix guard host; on Windows map run_as to the guard's own
// account or use an action that logs in remotely (as_user = false).
func setRunAsUser(_ *exec.Cmd, name string) error {
	return errors.New("run_as " + name + ": switching users is not supported on Windows; set as_user = false")
}
