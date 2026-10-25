package daemon

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// StopCurrentService unloads only the launchd job whose main PID is this
// process. Keep its plist so it starts again on the next login.
func StopCurrentService() error {
	out, err := runLaunchctl("list")
	if err != nil {
		return fmt.Errorf("find current launchd job: %w", err)
	}
	pid := strconv.Itoa(os.Getpid())
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 3 || fields[0] != pid {
			continue
		}
		label := fields[2]
		for _, domain := range launchdDomains() {
			target := domain + "/" + label
			info, err := runLaunchctl("print", target)
			if err != nil {
				continue
			}
			for _, row := range strings.Split(info, "\n") {
				if strings.TrimSpace(row) == "pid = "+pid {
					if out, err := runLaunchctl("bootout", target); err != nil {
						return fmt.Errorf("stop current launchd job %s: %s: %w", target, out, err)
					}
					return nil
				}
			}
		}
		return fmt.Errorf("cannot locate current launchd job %s", label)
	}
	return nil // launched directly, with no supervising job
}
