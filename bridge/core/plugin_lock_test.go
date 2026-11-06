package core

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestPluginLockRespectsDSHTakeoverClaim(t *testing.T) {
	// A completed child gives us a proven dead PID without guessing an unused PID.
	child := exec.Command(os.Args[0], "-test.run=^$")
	if err := child.Run(); err != nil {
		t.Fatal(err)
	}
	record := []byte(fmt.Sprintf("%d\n", child.Process.Pid))
	manifest := filepath.Join(t.TempDir(), "package.json")
	lock := manifest + ".lock"
	if err := os.WriteFile(lock, record, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(record)
	// DSH atomic-write uses the first 16 hexadecimal SHA256 characters for its claim.
	claim := fmt.Sprintf("%s.takeover-%x", lock, digest[:8])
	if err := os.WriteFile(claim, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0o600); err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- withPluginProfileLock(manifest, func() error {
			close(entered)
			return nil
		})
	}()
	select {
	case <-entered:
		t.Fatal("Go writer entered while DSH held the dead-lock takeover claim")
	case <-time.After(100 * time.Millisecond):
	}
	if err := os.Remove(claim); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("writer did not recover after the DSH takeover claim was released")
	}
}

func TestPluginLockDoesNotTakeOverLiveOrIncompleteRecords(t *testing.T) {
	for _, record := range []string{
		fmt.Sprintf("%d\n", os.Getpid()),
		"", "0\n", "-1\n", "2147483648\n", "123", "123\nextra", "+123\n",
	} {
		t.Run(fmt.Sprintf("%q", record), func(t *testing.T) {
			lock := filepath.Join(t.TempDir(), "package.json.lock")
			if err := os.WriteFile(lock, []byte(record), 0o600); err != nil {
				t.Fatal(err)
			}
			removed, err := takeOverExitedPluginLock(lock)
			if err != nil || removed {
				t.Fatalf("unproven dead holder removed=%v err=%v", removed, err)
			}
			raw, err := os.ReadFile(lock)
			if err != nil || string(raw) != record {
				t.Fatalf("record changed: %q, %v", raw, err)
			}
		})
	}
}
