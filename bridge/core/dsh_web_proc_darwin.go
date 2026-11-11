//go:build darwin

package core

import (
	"context"
	"encoding/binary"
	"strings"

	"golang.org/x/sys/unix"
)

// dshWebProcLookupNow reads pid's command line and environment in one call. `kern.procargs2` returns
// the argc (int32), the path the process was executed from, padding, then argc argv strings and the
// environment, all NUL-separated. Measured on this machine (wk/probe-proc, 2026-11-09): the argv
// strings start at the first non-empty token after the exec path, and the KEY=VALUE environment
// follows them — pid 70798 (`node …/dsh --profile web`) at [2..8], pid 74131 (the desktop host,
// five empty padding tokens) at [6..13]. Anything else (another user's process, a kernel that hides
// it) answers ok=false and the caller refuses rather than guesses.
func dshWebProcLookupNow(ctx context.Context, pid int) (argv []string, env map[string]string, envKnown, ok bool) {
	if pid <= 0 || ctx.Err() != nil {
		return nil, nil, false, false
	}
	raw, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil || len(raw) < 5 {
		return nil, nil, false, false
	}
	argc := int(binary.LittleEndian.Uint32(raw[:4]))
	fields := strings.Split(string(raw[4:]), "\x00")
	if argc <= 0 {
		return nil, nil, false, false
	}
	start := -1
	for i := 1; i < len(fields); i++ {
		if fields[i] != "" {
			start = i
			break
		}
	}
	if start < 0 || start >= len(fields) {
		return nil, nil, false, false
	}
	end := start + argc
	if end > len(fields) {
		end = len(fields)
	}
	return fields[start:end], dshWebEnvMap(fields[end:]), true, true
}
