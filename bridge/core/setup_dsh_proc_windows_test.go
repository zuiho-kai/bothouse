//go:build windows

package core

import (
	"os/exec"
	"testing"
	"time"
)

// Signal(0) is "not supported by windows", so the old check called every DSH web process dead
// and the /dsh proxy answered 503. The process-state query must see a running child as alive.
func TestProcessAliveWindows(t *testing.T) {
	cmd := exec.Command("ping", "-n", "30", "127.0.0.1")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	if !processAlive(pid) {
		t.Fatalf("running pid %d reported dead", pid)
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	deadline := time.Now().Add(3 * time.Second)
	for processAlive(pid) && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if processAlive(pid) {
		t.Fatalf("killed pid %d still reported alive", pid)
	}
	if processAlive(0) || processAlive(-1) {
		t.Fatal("pid <= 0 must be dead")
	}
}
