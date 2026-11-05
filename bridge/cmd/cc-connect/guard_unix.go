//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"os/user"
	"strconv"
	"syscall"
)

// setRunAsUser makes the command run as name (the guard runs as root).
func setRunAsUser(c *exec.Cmd, name string) error {
	u, err := user.Lookup(name)
	if err != nil {
		return fmt.Errorf("run_as %s: %w", name, err)
	}
	uid, err1 := strconv.ParseUint(u.Uid, 10, 32)
	gid, err2 := strconv.ParseUint(u.Gid, 10, 32)
	if err1 != nil || err2 != nil {
		return fmt.Errorf("run_as %s: bad uid/gid", name)
	}
	c.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)}}
	c.Dir = u.HomeDir
	return nil
}
