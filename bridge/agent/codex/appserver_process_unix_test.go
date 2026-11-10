//go:build unix

package codex

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type unixAppServerPIDs struct {
	parent, worker, peer int
}

// TestAppServerSession_UnixProcessTreeCleanup exercises the real stdio start
// path and verifies that every teardown path stops the app-server plus its
// workers, while a process in another session survives.
func TestAppServerSession_UnixProcessTreeCleanup(t *testing.T) {
	bin := buildUnixAppServerFixture(t)

	for _, stop := range []struct {
		name string
		run  func(*appServerSession, context.CancelFunc)
	}{
		{"Close", func(s *appServerSession, _ context.CancelFunc) {
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
		}},
		{"AbortTransport", func(s *appServerSession, _ context.CancelFunc) {
			s.abortTransport()
		}},
		{"ContextCancellation", func(_ *appServerSession, cancel context.CancelFunc) {
			cancel()
		}},
	} {
		t.Run(stop.name, func(t *testing.T) {
			s, cancel, pids := startUnixAppServerSession(t, bin)
			t.Cleanup(func() {
				_ = s.Close()
				killUnixTestProcess(pids.parent)
				killUnixTestProcess(pids.worker)
				killUnixTestProcess(pids.peer)
			})

			stop.run(s, cancel)

			waitProcessGone(t, pids.parent)
			waitProcessGone(t, pids.worker)
			if !unixProcessAlive(pids.peer) {
				t.Fatalf("%s terminated unrelated peer %d", stop.name, pids.peer)
			}
		})
	}
}

func buildUnixAppServerFixture(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "appserver-fixture")
	build := exec.Command("go", "build", "-buildvcs=false", "-o", bin, "./testdata/unix_appserver")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build native app-server fixture: %v\n%s", err, output)
	}
	return bin
}

func startUnixAppServerSession(t *testing.T, bin string) (*appServerSession, context.CancelFunc, unixAppServerPIDs) {
	t.Helper()
	dir := t.TempDir()
	pidFile := filepath.Join(dir, "parent.pid")
	workerFile := filepath.Join(dir, "worker.pid")
	peerFile := filepath.Join(dir, "peer.pid")

	ctx, cancel := context.WithCancel(context.Background())
	s := &appServerSession{
		bin:     bin,
		workDir: dir,
		ctx:     ctx,
		cancel:  cancel,
		events:  make(chan core.Event, 8),
		pending: make(map[int64]chan rpcResponseEnvelope),
		extraEnv: []string{
			"FIXTURE_PID_FILE=" + pidFile,
			"FIXTURE_WORKER_PID_FILE=" + workerFile,
			"FIXTURE_PEER_PID_FILE=" + peerFile,
		},
	}
	if err := s.connect(); err != nil {
		cancel()
		t.Fatalf("start app-server fixture: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	pids := unixAppServerPIDs{
		parent: readUnixTestPID(t, pidFile),
		worker: readUnixTestPID(t, workerFile),
		peer:   readUnixTestPID(t, peerFile),
	}
	return s, cancel, pids
}

func readUnixTestPID(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil {
			text := strings.TrimSpace(string(data))
			if text != "" {
				pid, parseErr := strconv.Atoi(text)
				if parseErr != nil || pid <= 0 {
					t.Fatalf("invalid pid in %s: %q", path, data)
				}
				return pid
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("fixture did not write %s", path)
	return 0
}

func waitProcessGone(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if !unixProcessAlive(pid) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("process %d still running after teardown", pid)
}

func unixProcessAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func killUnixTestProcess(pid int) {
	if pid > 0 {
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
}
