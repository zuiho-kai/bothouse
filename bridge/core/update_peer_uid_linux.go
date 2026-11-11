//go:build linux

package core

import (
	"net"

	"golang.org/x/sys/unix"
)

// unixPeerUID: SO_PEERCRED gives the peer's uid (cred.Uid) on the accepted socket.
func unixPeerUID(c *net.UnixConn) (uint32, bool) {
	raw, err := c.SyscallConn()
	if err != nil {
		return 0, false
	}
	var cred *unix.Ucred
	var gerr error
	if err := raw.Control(func(fd uintptr) {
		cred, gerr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	}); err != nil || gerr != nil || cred == nil {
		return 0, false
	}
	return cred.Uid, true
}
