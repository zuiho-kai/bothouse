//go:build linux

package core

import (
	"os"
	"strconv"
	"strings"
)

// dshWebProcLookupNow reads pid's command line and environment from /proc. cmdline is NUL-separated
// argv with no exec path in front; environ is NUL-separated KEY=VALUE. Both are unreadable for
// another user's process (hidepid, a container, a kernel that hides it) and then ok is false, so the
// caller refuses rather than guesses.
func dshWebProcLookupNow(pid int) (argv []string, env map[string]string, envKnown, ok bool) {
	if pid <= 0 {
		return nil, nil, false, false
	}
	raw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/cmdline")
	if err != nil || len(raw) == 0 {
		return nil, nil, false, false
	}
	argv = strings.Split(strings.TrimRight(string(raw), "\x00"), "\x00")
	if len(argv) == 0 || argv[0] == "" {
		return nil, nil, false, false
	}
	environ, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/environ")
	if err != nil {
		return argv, nil, false, true
	}
	return argv, dshWebEnvMap(strings.Split(string(environ), "\x00")), true, true
}
