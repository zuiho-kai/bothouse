//go:build !windows

package core

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The real runner kills the whole process group on timeout (watchvid → uv → ffmpeg …).
func TestRunProcessGroupKillsChildren(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "pid")
	ctx, cancel := withLimit(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, _, err := runProcessGroup(ctx, "/bin/sh", "-c", "sleep 30 & echo $! > "+pidFile+"; wait")
	if err == nil || !strings.Contains(err.Error(), "超时") {
		t.Fatalf("err = %v", err)
	}
	if d := time.Since(start); d > 10*time.Second {
		t.Fatalf("returned after %v", d)
	}
	b, _ := os.ReadFile(pidFile)
	pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	if pid == 0 {
		t.Fatal("child pid not written")
	}
	time.Sleep(100 * time.Millisecond)
	if syscall.Kill(pid, 0) == nil {
		syscall.Kill(pid, syscall.SIGKILL)
		t.Fatalf("grandchild %d survived", pid)
	}
}
