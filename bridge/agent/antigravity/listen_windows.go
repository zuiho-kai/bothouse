//go:build windows

package antigravity

import (
	"context"

	"github.com/chenhg5/cc-connect/core"
)

// cliListenAddrs: Windows has no lsof (#2265); the subprocess's loopback listeners come from the
// system TCP table instead, still filtered to the exact PID.
func cliListenAddrs(_ context.Context, pid int) ([]string, error) {
	var addresses []string
	for _, a := range core.LoopbackListenAddrsOfPID(pid) {
		addresses = append(addresses, "http://"+a)
	}
	return addresses, nil
}
