//go:build !windows

package main

import (
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// reexecEnv marks a process image started by restartProcess (#1729).
const reexecEnv = "BOTHOUSE_REEXEC"

func restartProcess(execPath string) error {
	env := append(os.Environ(), reexecEnv+"=1")
	return syscall.Exec(execPath, os.Args, env)
}

// reapInheritedChildren waits for the children started by the previous image (#1729).
// syscall.Exec keeps the PID, so children the old image started (e.g. the detached DSH web host)
// stay our children, but the goroutines that called cmd.Wait on them are gone: when such a child
// exits it stays a zombie until the bridge exits. The new image does not know these PIDs, so it
// lists its own children once at startup and waits for each one. A child started by this image
// is never in the list (none exist yet), so this does not race with os/exec's own Wait.
func reapInheritedChildren() {
	if os.Getenv(reexecEnv) == "" {
		return
	}
	_ = os.Unsetenv(reexecEnv)
	for _, pid := range listChildPIDs(os.Getpid()) {
		go func(pid int) {
			var ws syscall.WaitStatus
			for {
				_, err := syscall.Wait4(pid, &ws, 0, nil)
				if err != syscall.EINTR {
					break
				}
			}
			slog.Info("restart: reaped child of previous image", "pid", pid)
		}(pid)
	}
}

// listChildPIDs returns the PIDs whose parent is ppid (ps works on macOS and Linux).
func listChildPIDs(ppid int) []int {
	cmd := exec.Command("ps", "-A", "-o", "pid=,ppid=")
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var pids []int
	for _, pid := range parseChildPIDs(string(out), ppid) {
		if pid != cmd.Process.Pid { // ps lists itself; os/exec already waited for it
			pids = append(pids, pid)
		}
	}
	return pids
}

func parseChildPIDs(psOut string, ppid int) []int {
	var pids []int
	for _, line := range strings.Split(psOut, "\n") {
		f := strings.Fields(line)
		if len(f) != 2 {
			continue
		}
		pid, err1 := strconv.Atoi(f[0])
		parent, err2 := strconv.Atoi(f[1])
		if err1 == nil && err2 == nil && parent == ppid && pid != ppid {
			pids = append(pids, pid)
		}
	}
	return pids
}
