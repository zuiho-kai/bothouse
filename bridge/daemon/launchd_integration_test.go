//go:build darwin

package daemon

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

var testLaunchdIntegration = flag.Bool("launchd-integration", false, "exercise a temporary, isolated launchd job on macOS")

// Opt in with:
// go test -tags no_web ./daemon -run '^TestLaunchdIntegration1725$' -count=1 -args -launchd-integration
// The helper has no platforms, credentials or network activity. Its unique
// label and temporary HOME keep every operation away from the installed job.
func TestLaunchdIntegration1725(t *testing.T) {
	if !*testLaunchdIntegration {
		t.Skip("requires explicit -launchd-integration and access to the current user's launchd domain")
	}
	dir := t.TempDir()
	testutil.SetHome(t, dir)
	label := fmt.Sprintf("com.bothouse.test1725.%d.%d", os.Getpid(), time.Now().UnixNano())
	t.Setenv(launchdLabelEnv, label)
	events := filepath.Join(dir, "events.log")
	helper := filepath.Join(dir, "slow-stop.sh")
	script := `#!/bin/sh
trap '/bin/echo "stopping $$" >> "$TEST_EVENTS"; /bin/sleep 3; exit 0' TERM
/bin/echo "started $$ $TEST_GENERATION" >> "$TEST_EVENTS"
while :; do /bin/sleep 0.1; done
`
	if err := os.WriteFile(helper, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	gui, user := launchdGUIDomain(), launchdUserDomain()
	original := runLaunchctl
	t.Cleanup(func() { runLaunchctl = original })
	runLaunchctl = func(args ...string) (string, error) {
		target := args[len(args)-1]
		allowed := target == launchdTarget(gui) || target == launchdTarget(user)
		if args[0] == "print" && (target == gui || target == user) {
			allowed = true
		}
		if args[0] == "bootstrap" && len(args) == 3 && (args[1] == gui || args[1] == user) && args[2] == launchdPlistPath() {
			allowed = true
		}
		if !allowed {
			t.Fatalf("refusing launchctl call outside the isolated job: %v", args)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "/bin/launchctl", args...).CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	var lastPID int
	t.Cleanup(func() {
		for _, target := range []string{launchdTarget(gui), launchdTarget(user)} {
			_, _ = runLaunchctl("bootout", target)
		}
		deadline := time.Now().Add(25 * time.Second)
		for lastPID > 0 && syscall.Kill(lastPID, 0) == nil && time.Now().Before(deadline) {
			time.Sleep(100 * time.Millisecond)
		}
		if lastPID > 0 && syscall.Kill(lastPID, 0) == nil {
			t.Errorf("isolated helper %d did not exit after bootout", lastPID)
		}
	})
	mgr := &launchdManager{}
	waitStarted := func(previous int, generation string) int {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			status, err := mgr.Status()
			if err != nil {
				t.Fatal(err)
			}
			if status.Running && status.PID > 0 && status.PID != previous {
				lastPID = status.PID
				body, _ := os.ReadFile(events)
				if strings.Contains(string(body), fmt.Sprintf("started %d %s\n", status.PID, generation)) {
					return status.PID
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatalf("service did not start with a new PID and generation %s", generation)
		return 0
	}
	cfg := Config{BinaryPath: helper, WorkDir: dir, LogFile: filepath.Join(dir, "service.log"), EnvPATH: "/usr/bin:/bin",
		EnvExtra: map[string]string{"TEST_EVENTS": events, "TEST_GENERATION": "original"}}
	if err := mgr.Install(cfg); err != nil {
		t.Fatal(err)
	}
	pid := waitStarted(0, "original")
	start := time.Now()
	if err := mgr.Restart(); err != nil {
		t.Fatalf("restart of slow-stopping isolated job: %v", err)
	}
	next := waitStarted(pid, "original")
	body, _ := os.ReadFile(events)
	if !strings.Contains(string(body), fmt.Sprintf("stopping %d\n", pid)) || time.Since(start) < 3*time.Second {
		t.Fatal("restart did not exercise the helper's three-second graceful shutdown")
	}
	t.Logf("Restart: old PID %d -> %d, elapsed %s, service running", pid, next, time.Since(start).Round(time.Millisecond))
	pid = next
	cfg.EnvExtra["TEST_GENERATION"] = "reinstalled"
	start = time.Now()
	if err := mgr.Install(cfg); err != nil {
		t.Fatalf("reinstall of slow-stopping isolated job: %v", err)
	}
	next = waitStarted(pid, "reinstalled")
	body, _ = os.ReadFile(events)
	if !strings.Contains(string(body), fmt.Sprintf("stopping %d\n", pid)) || time.Since(start) < 3*time.Second {
		t.Fatal("reinstall did not exercise the helper's three-second graceful shutdown")
	}
	t.Logf("Install: old PID %d -> %d, elapsed %s, replacement configuration active", pid, next, time.Since(start).Round(time.Millisecond))
}
