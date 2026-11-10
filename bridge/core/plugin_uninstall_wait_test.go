package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestWaitPluginUninstallIdleGivesUp: the cleanup wait runs inside the profile lock and after the
// handler's ctx expired, so a job that never reports zero processes must end in an error, not in
// an endless 20ms loop. The observed lower bound is the bound itself.
func TestWaitPluginUninstallIdleGivesUp(t *testing.T) {
	const bound = 60 * time.Millisecond
	start := time.Now()
	err := waitPluginUninstallIdle(func() (uint32, error) { return 2, nil }, bound)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("a job that never reports zero processes returned success")
	}
	if elapsed < bound {
		t.Fatalf("gave up after %s, before the %s bound", elapsed, bound)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("took %s: the bound did not end the loop", elapsed)
	}
}

// TestWaitPluginUninstallIdleReturnsWhenIdle: the success path is unchanged — zero processes is
// success on the first query, and a query error is reported instead of being read as "0".
func TestWaitPluginUninstallIdleReturnsWhenIdle(t *testing.T) {
	if err := waitPluginUninstallIdle(func() (uint32, error) { return 0, nil }, time.Second); err != nil {
		t.Fatalf("idle job reported an error: %v", err)
	}
	sentinel := errors.New("query failed")
	err := waitPluginUninstallIdle(func() (uint32, error) { return 0, sentinel }, time.Second)
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want the query error", err)
	}
}

// TestPluginLockRetainSurvivesCleanupFailure: errPluginLockRetain is the one error that must leave
// the PID record in place — returning it because the child tree could not be confirmed dead must
// not let the next writer in. Every other error still releases the lock.
func TestPluginLockRetainSurvivesCleanupFailure(t *testing.T) {
	cases := []struct {
		name   string
		result error
		keep   bool
	}{
		{"cleanup unconfirmed", fmt.Errorf("%w: 等不到卸载子进程归零", errPluginLockRetain), true},
		{"joined unconfirmed", errors.Join(errors.New("exit status 1"), fmt.Errorf("%w: x", errPluginLockRetain)), true},
		{"ordinary failure", errors.New("pnpm failed"), false},
		{"success", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			manifest := filepath.Join(t.TempDir(), "package.json")
			err := withPluginProfileLock(manifest, func() error { return c.result })
			if !errors.Is(err, c.result) && c.result != nil {
				t.Fatalf("err = %v, want %v", err, c.result)
			}
			_, statErr := os.Stat(manifest + ".lock")
			if c.keep {
				if statErr != nil {
					t.Fatalf("lock record was removed after an unconfirmed cleanup: %v", statErr)
				}
				return
			}
			if statErr == nil {
				t.Fatal("lock record survived a released lock")
			}
		})
	}
}
