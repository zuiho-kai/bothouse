//go:build !windows

package main

import (
	"os"
	"os/exec"
	"slices"
	"syscall"
	"testing"
	"time"
)

func TestParseChildPIDs(t *testing.T) {
	got := parseChildPIDs("  10 1\n 11 10\n 12 10\n 13 11\nbad line here\n 10 10\n", 10)
	if !slices.Equal(got, []int{11, 12}) {
		t.Fatalf("got %v", got)
	}
}

// #1729: a child the previous image started and never waited for is reaped after re-exec.
func TestReapInheritedChildrenReapsZombie(t *testing.T) {
	cmd := exec.Command("true")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	time.Sleep(200 * time.Millisecond) // exits, stays a zombie: nobody waits
	t.Setenv(reexecEnv, "1")
	reapInheritedChildren()
	if os.Getenv(reexecEnv) != "" {
		t.Fatal("marker not cleared")
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if slices.Contains(listChildPIDs(os.Getpid()), pid) {
			time.Sleep(50 * time.Millisecond)
			continue
		}
		var ws syscall.WaitStatus
		if _, err := syscall.Wait4(pid, &ws, syscall.WNOHANG, nil); err != syscall.ECHILD {
			t.Fatalf("pid %d still waitable: %v", pid, err)
		}
		return
	}
	t.Fatalf("zombie %d not reaped", pid)
}
