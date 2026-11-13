//go:build darwin

package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// A draining job remains visible for ten seconds. Even once print stops
// listing it, bootstrap can still report EIO until launchd releases its name.
// Time is virtual; no test contacts the machine's launchd or real service.
type drainingLaunchd struct {
	now              time.Time
	bootoutAt        time.Time
	domain           string
	loaded           bool
	started          bool
	drainingFor      time.Duration
	nameReservedFor  time.Duration
	bootstrapBlocked bool
	bootstrapCalls   int
	prematureLoads   int
}

func fakeDrainingLaunchd(t *testing.T, headless bool) *drainingLaunchd {
	t.Helper()
	testutil.SetHome(t, t.TempDir())
	t.Setenv(launchdLabelEnv, "com.bothouse.test-1725")
	f := &drainingLaunchd{
		now: time.Unix(1_000, 0), domain: launchdGUIDomain(), loaded: true,
		drainingFor: 10 * time.Second, nameReservedFor: 18 * time.Second,
	}
	if headless {
		f.domain = launchdUserDomain()
	}
	originalRun, originalNow, originalSleep := runLaunchctl, launchdNow, launchdSleep
	t.Cleanup(func() { runLaunchctl, launchdNow, launchdSleep = originalRun, originalNow, originalSleep })
	launchdNow = func() time.Time { return f.now }
	launchdSleep = func(d time.Duration) { f.now = f.now.Add(d) }
	runLaunchctl = func(args ...string) (string, error) {
		age := f.now.Sub(f.bootoutAt)
		if !f.bootoutAt.IsZero() && age >= f.drainingFor {
			f.loaded = false
		}
		switch args[0] {
		case "print":
			if args[1] == f.domain {
				return "domain", nil
			}
			if args[1] == launchdTarget(f.domain) && f.loaded {
				return "state = running\npid = 123", nil
			}
			return "Could not find service", fmt.Errorf("exit status 113")
		case "bootout":
			if args[1] != launchdTarget(f.domain) || !f.loaded {
				return "Could not find service", fmt.Errorf("exit status 113")
			}
			f.bootoutAt = f.now
			f.started = false
			return "", nil
		case "bootstrap":
			f.bootstrapCalls++
			if args[1] != f.domain {
				t.Fatalf("bootstrap domain = %q, want %q", args[1], f.domain)
			}
			if f.loaded {
				f.prematureLoads++
			}
			if f.bootstrapBlocked || f.loaded || (!f.bootoutAt.IsZero() && age < f.nameReservedFor) {
				return "Bootstrap failed: 5: Input/output error", fmt.Errorf("exit status 5")
			}
			f.loaded = true
			f.bootoutAt = time.Time{}
			return "", nil
		case "kickstart":
			if !f.loaded {
				return "Could not find service", fmt.Errorf("exit status 113")
			}
			f.started = true
			return "456", nil
		default:
			t.Fatalf("unexpected launchctl command: %v", args)
			return "", nil
		}
	}
	plist := launchdPlistPath()
	if err := os.MkdirAll(filepath.Dir(plist), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(plist, []byte("installed plist"), 0o600); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestLaunchdReload1725WaitsForSlowRemovalAndNameRelease(t *testing.T) {
	for _, operation := range []string{"restart", "install"} {
		for _, headless := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/headless=%t", operation, headless), func(t *testing.T) {
				f := fakeDrainingLaunchd(t, headless)
				start := f.now
				mgr := &launchdManager{}
				var err error
				if operation == "install" {
					err = mgr.Install(autostartTestCfg(t))
				} else {
					err = mgr.Restart()
				}
				if err != nil {
					t.Fatalf("%s left the slow-stopping service unloaded: %v", operation, err)
				}
				if !f.loaded || !f.started {
					t.Fatalf("service was not restarted: loaded=%t started=%t", f.loaded, f.started)
				}
				if f.prematureLoads != 0 {
					t.Fatalf("bootstrap attempted %d times before the old job disappeared", f.prematureLoads)
				}
				if elapsed := f.now.Sub(start); elapsed < 18*time.Second || elapsed > 30*time.Second {
					t.Fatalf("reload elapsed %s, want the 18s name-release delay within a 30s bound", elapsed)
				}
			})
		}
	}
}

func TestLaunchdReload1725FailureIsBoundedAndRecoverable(t *testing.T) {
	for _, operation := range []string{"restart", "install"} {
		t.Run(operation, func(t *testing.T) {
			f := fakeDrainingLaunchd(t, false)
			f.bootstrapBlocked = true
			start := f.now
			mgr := &launchdManager{}
			var err error
			if operation == "install" {
				err = mgr.Install(autostartTestCfg(t))
			} else {
				err = mgr.Restart()
			}
			if err == nil || !strings.Contains(err.Error(), "bothouse daemon start") || !strings.Contains(err.Error(), "Bootstrap failed: 5") {
				t.Fatalf("failure must retain launchd's error and explain recovery: %v", err)
			}
			if elapsed := f.now.Sub(start); elapsed != 30*time.Second {
				t.Fatalf("failure elapsed %s, want a bounded 30s attempt", elapsed)
			}
			if f.loaded || f.started {
				t.Fatal("failed reload must not report the service as running")
			}
			f.bootstrapBlocked = false
			if err := mgr.Start(); err != nil || !f.loaded {
				t.Fatalf("documented recovery did not load the saved plist: %v", err)
			}
		})
	}
}
