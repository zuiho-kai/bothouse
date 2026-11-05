//go:build !windows

package core

import (
	"os/exec"
	"strconv"
	"strings"
)

// dshWebListeners returns the loopback ports this process can see listening, as candidates for a
// host that was restarted on another port. Without lsof (or without permission) it returns nothing
// and the ports already known are all that is tried.
func dshWebListeners() []string {
	out, err := exec.Command("lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "n").Output()
	if err != nil {
		return nil
	}
	seen := make(map[string]bool)
	list := make([]string, 0, 4)
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, "n127.0.0.1:") {
			continue
		}
		if port := strings.TrimPrefix(line, "n127.0.0.1:"); port != "" && !seen[port] {
			seen[port] = true
			list = append(list, port)
		}
	}
	return list
}

// pidListeningOnPort is the pid holding port, or 0 when it cannot be told (no lsof, no permission).
// The state file stays usable with pid 0: the address and token are what the proxy uses.
func pidListeningOnPort(port string) int {
	out, err := exec.Command("lsof", "-nP", "-iTCP:"+port, "-sTCP:LISTEN", "-t").Output()
	if err != nil {
		return 0
	}
	for _, field := range strings.Fields(string(out)) {
		if pid, err := strconv.Atoi(field); err == nil && pid > 0 {
			return pid
		}
	}
	return 0
}
