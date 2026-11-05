//go:build darwin

package core

import (
	"bytes"
	"encoding/binary"
	"net"

	"golang.org/x/sys/unix"
)

// peerProcessID: LOCAL_PEERPID gives the peer's pid.
func peerProcessID(c *net.UnixConn) (int, bool) {
	raw, err := c.SyscallConn()
	if err != nil {
		return 0, false
	}
	pid, gerr := 0, error(nil)
	if err := raw.Control(func(fd uintptr) {
		pid, gerr = unix.GetsockoptInt(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	}); err != nil || gerr != nil || pid <= 0 {
		return 0, false
	}
	return pid, true
}

// processEnvironment reads the process's environment from kern.procargs2: the
// block is argc (int32), the executable path, the NUL-padded argv strings and
// then the environment, NUL separated.
func processEnvironment(pid int) ([]byte, bool) {
	buf, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil || len(buf) < 8 {
		return nil, false
	}
	argc := int(int32(binary.LittleEndian.Uint32(buf[:4])))
	if argc < 0 || argc > 4096 {
		return nil, false
	}
	rest := buf[4:]
	// A leading zero byte, then the executable path, then argc+1 NUL-terminated
	// argv strings (argv[argc] is the trailing NULL), then the environment.
	if len(rest) == 0 || rest[0] != 0 {
		return nil, false
	}
	rest = rest[1:]
	next := func(rest []byte) (string, []byte, bool) {
		i := bytes.IndexByte(rest, 0)
		if i < 0 {
			return "", nil, false
		}
		return string(rest[:i]), rest[i+1:], true
	}
	_, rest, ok := next(rest) // executable path
	if !ok {
		return nil, false
	}
	for i := 0; i <= argc; i++ {
		_, rest, ok = next(rest)
		if !ok {
			return nil, false
		}
	}
	return rest, true
}

// parentProcessID reads the parent's pid from the process table. A netstat/ps
// parse would race with pid reuse; unix.SysctlKinfoProc gives kinfo_proc's ppid
// field directly.
func parentProcessID(pid int) int {
	kp, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil || kp == nil || int(kp.Proc.P_pid) != pid {
		return 0
	}
	return int(kp.Eproc.Ppid)
}
