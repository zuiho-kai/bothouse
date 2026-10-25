//go:build darwin

package core

import (
	"bytes"
	"encoding/binary"
	"net"

	"golang.org/x/sys/unix"
)

// unixPeerExe: LOCAL_PEERPID gives the peer's pid; kern.procargs2 starts with argc (int32) and
// then the path the process was executed from.
func unixPeerExe(c *net.UnixConn) (string, bool) {
	raw, err := c.SyscallConn()
	if err != nil {
		return "", false
	}
	pid, gerr := 0, error(nil)
	if err := raw.Control(func(fd uintptr) {
		pid, gerr = unix.GetsockoptInt(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	}); err != nil || gerr != nil || pid <= 0 {
		return "", false
	}
	buf, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil || len(buf) < 5 {
		return "", false
	}
	_ = binary.LittleEndian.Uint32(buf[:4]) // argc
	path := buf[4:]
	if i := bytes.IndexByte(path, 0); i >= 0 {
		path = path[:i]
	}
	if len(path) == 0 {
		return "", false
	}
	return string(path), true
}
