//go:build linux

package core

import (
	"net"
	"os"
	"strconv"

	"golang.org/x/sys/unix"
)

// unixPeerExe: SO_PEERCRED gives the peer's pid; /proc/<pid>/exe is its executable.
func unixPeerExe(c *net.UnixConn) (string, bool) {
	raw, err := c.SyscallConn()
	if err != nil {
		return "", false
	}
	var cred *unix.Ucred
	var gerr error
	if err := raw.Control(func(fd uintptr) {
		cred, gerr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	}); err != nil || gerr != nil || cred == nil || cred.Pid <= 0 {
		return "", false
	}
	target, err := os.Readlink("/proc/" + strconv.Itoa(int(cred.Pid)) + "/exe")
	if err != nil {
		return "", false
	}
	return procExeTarget(target)
}
