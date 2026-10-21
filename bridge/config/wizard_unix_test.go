//go:build !windows

package config

import (
	"path/filepath"
	"testing"
	"time"
)

// Round 3 #4: the Unix file lock gives up after configLockWait instead of blocking forever.
func TestLockConfigFileTimesOut(t *testing.T) {
	old := configLockWait
	configLockWait = 200 * time.Millisecond
	defer func() { configLockWait = old }()
	p := filepath.Join(t.TempDir(), "config.toml")
	rel, err := lockConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	defer rel()
	start := time.Now()
	if _, err := lockConfigFile(p); err == nil || time.Since(start) > 2*time.Second {
		t.Fatalf("second lock: err=%v after %v", err, time.Since(start))
	}
}
