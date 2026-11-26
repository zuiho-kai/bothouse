//go:build !windows

package antigravity

import (
	"context"
	"errors"
	"os/exec"
	"strconv"
)

// cliListenAddrs inspects only the exact subprocess PID, never other apps or agents. lsof is
// supplied by macOS and is an explicit prerequisite on other unix platforms.
func cliListenAddrs(ctx context.Context, pid int) ([]string, error) {
	raw, err := exec.CommandContext(ctx, "lsof", "-nP", "-a", "-p", strconv.Itoa(pid), "-iTCP", "-sTCP:LISTEN", "-Fn").Output()
	if err != nil {
		return nil, errors.New("quota: cannot discover CLI listener (lsof required)")
	}
	return nativeQuotaAddresses(string(raw)), nil
}
