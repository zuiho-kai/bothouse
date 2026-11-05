//go:build linux

package core

import (
	"net"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

// peerProcessID: SO_PEERCRED gives the peer's pid.
func peerProcessID(c *net.UnixConn) (int, bool) {
	raw, err := c.SyscallConn()
	if err != nil {
		return 0, false
	}
	var cred *unix.Ucred
	var gerr error
	if err := raw.Control(func(fd uintptr) {
		cred, gerr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	}); err != nil || gerr != nil || cred == nil || cred.Pid <= 0 {
		return 0, false
	}
	return int(cred.Pid), true
}

// processEnvironment reads /proc/<pid>/environ (NUL separated). Only the owner
// and root can read it, so a same-uid agent can read another same-uid process's
// environment — this check limits which process may ask, it does not isolate
// same-uid processes from each other.
func processEnvironment(pid int) ([]byte, bool) {
	block, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/environ")
	if err != nil {
		return nil, false
	}
	return block, true
}

// parentProcessID reads PPid from /proc/<pid>/stat.
func parentProcessID(pid int) int {
	stat, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return 0
	}
	// The command name is parenthesised and may contain spaces or parentheses,
	// so parse from the last ')': after it come state, ppid, …
	text := string(stat)
	close := -1
	for i := len(text) - 1; i >= 0; i-- {
		if text[i] == ')' {
			close = i
			break
		}
	}
	if close < 0 {
		return 0
	}
	fields := strings.Fields(text[close+1:])
	if len(fields) < 2 {
		return 0
	}
	ppid, err := strconv.Atoi(fields[1])
	if err != nil || ppid < 0 {
		return 0
	}
	return ppid
}
