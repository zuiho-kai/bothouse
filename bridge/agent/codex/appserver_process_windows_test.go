//go:build windows

package codex

import (
	"context"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// Exercise the actual stdio startup path with a native console executable.
// Linking the test host with -H=windowsgui also reproduces the desktop app's
// GUI-parent/console-child relationship without real credentials or messages.
func TestAppServerSession_WindowsBackgroundLifecycle(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "appserver-helper.exe")
	build := exec.Command("go", "build", "-buildvcs=false", "-o", bin, "./testdata/windows_appserver")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build native helper: %v\n%s", err, output)
	}

	start := func(t *testing.T) (*appServerSession, context.CancelFunc) {
		t.Helper()
		ctx, cancel := context.WithCancel(context.Background())
		t.Cleanup(cancel)
		dir := t.TempDir()
		s, err := newAppServerSession(ctx, bin, "", dir, "", "", "full-auto", "", "", "", nil,
			filepath.Join(dir, "codex-home"), "", "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = s.Close() })
		return s, cancel
	}

	t.Run("NoConsoleAndStdio", func(t *testing.T) {
		s, _ := start(t)
		var status struct {
			ConsoleWindow uint64 `json:"consoleWindow"`
		}
		if err := s.request("test/status", nil, &status); err != nil {
			t.Fatal(err)
		}
		if status.ConsoleWindow != 0 {
			t.Fatalf("Codex app-server is attached to console %#x; closing it terminates the worker", status.ConsoleWindow)
		}
		var reply struct {
			Text string `json:"text"`
		}
		if err := s.request("test/echo", map[string]string{"text": "stdio still works"}, &reply); err != nil {
			t.Fatal(err)
		}
		if reply.Text != "stdio still works" || !s.Alive() {
			t.Fatalf("background worker lost stdio: reply=%q alive=%v", reply.Text, s.Alive())
		}
	})

	// An unrelated Codex-like process must survive each session's teardown.
	peer := exec.Command(bin, "idle")
	peer.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000, HideWindow: true}
	if err := peer.Start(); err != nil {
		t.Fatal(err)
	}
	peerHandle := openWindowsTestProcess(t, uint32(peer.Process.Pid))
	t.Cleanup(func() {
		_ = peer.Process.Kill()
		_ = peer.Wait()
	})

	for _, stop := range []string{"Close", "AbortTransport", "ContextCancellation"} {
		t.Run(stop, func(t *testing.T) {
			s, cancel := start(t)
			var child struct {
				PID uint32 `json:"pid"`
			}
			if err := s.request("test/startChild", nil, &child); err != nil {
				t.Fatal(err)
			}
			handle := openWindowsTestProcess(t, child.PID)
			// Clean up only this test's child even when the pre-fix code leaks it.
			t.Cleanup(func() { _ = windows.TerminateProcess(handle, 0) })
			if state, err := windows.WaitForSingleObject(handle, 0); err != nil || state != uint32(windows.WAIT_TIMEOUT) {
				t.Fatalf("child did not start: state=%d err=%v", state, err)
			}
			switch stop {
			case "Close":
				if err := s.Close(); err != nil {
					t.Fatal(err)
				}
			case "AbortTransport":
				s.abortTransport()
			case "ContextCancellation":
				cancel()
			}
			if state, err := windows.WaitForSingleObject(handle, uint32((5*time.Second)/time.Millisecond)); err != nil || state != windows.WAIT_OBJECT_0 {
				t.Fatalf("%s left app-server child %d running: state=%d err=%v", stop, child.PID, state, err)
			}
			if state, err := windows.WaitForSingleObject(peerHandle, 0); err != nil || state != uint32(windows.WAIT_TIMEOUT) {
				t.Fatalf("%s terminated an unrelated process: state=%d err=%v", stop, state, err)
			}
		})
	}
}

func openWindowsTestProcess(t *testing.T, pid uint32) windows.Handle {
	t.Helper()
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_TERMINATE, false, pid)
	if err != nil {
		t.Fatalf("open test process %d: %v", pid, err)
	}
	t.Cleanup(func() { _ = windows.CloseHandle(handle) })
	return handle
}
