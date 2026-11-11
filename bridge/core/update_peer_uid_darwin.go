//go:build darwin

package core

import (
	"net"

	"golang.org/x/sys/unix"
)

// unixPeerUID: LOCAL_PEERCRED gives an xucred whose Uid is the peer's effective uid on macOS.
func unixPeerUID(c *net.UnixConn) (uint32, bool) {
	raw, err := c.SyscallConn()
	if err != nil {
		return 0, false
	}
	var xu *unix.Xucred
	var gerr error
	if err := raw.Control(func(fd uintptr) {
		xu, gerr = unix.GetsockoptXucred(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	}); err != nil || gerr != nil || xu == nil {
		return 0, false
	}
	return xu.Uid, true
}
