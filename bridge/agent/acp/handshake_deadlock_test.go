package acp

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestTransportCallAfterReadClosedReturnsImmediately(t *testing.T) {
	rResp, wMockResp := io.Pipe()
	rReq, wTrOut := io.Pipe()
	defer rReq.Close()
	defer wTrOut.Close()

	// Drain requests so writeJSON succeeds even after the response reader closed.
	go func() {
		_, _ = io.Copy(io.Discard, rReq)
	}()

	tr := newTransport(rResp, wTrOut, nil, nil)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		tr.readLoop(context.Background())
	}()

	_ = wMockResp.Close()
	select {
	case <-readDone:
	case <-time.After(time.Second):
		t.Fatal("readLoop did not exit on EOF")
	}

	done := make(chan error, 1)
	go func() {
		_, err := tr.call(context.Background(), "initialize", map[string]any{"protocolVersion": 1})
		done <- err
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected error from call on closed transport")
		}
	case <-time.After(time.Second):
		t.Fatal("tr.call blocked forever after transport readLoop closed")
	}
}

func TestHandshakeKilledChildHoldingStdoutReturnsError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix shell child process test")
	}

	dir := t.TempDir()
	pidFile := filepath.Join(dir, "child.pid")
	script := filepath.Join(dir, "hang-acp.sh")
	// Spawn a background grandchild inheriting stdout (so stdout pipe does not EOF when
	// the main child exits), never reply to initialize, and wait to be killed.
	body := "#!/bin/sh\n" +
		"echo $$ > " + pidFile + "\n" +
		"sleep 30 &\n" +
		"exec sleep 30\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := newACPSession(context.Background(), acpSessionConfig{
			command: script,
			workDir: dir,
		})
		done <- err
	}()

	// Wait until the child writes its PID, then SIGKILL the child directly (simulating
	// an external kill while handshake is stuck waiting for initialize).
	deadline := time.Now().Add(2 * time.Second)
	var pid int
	for time.Now().Before(deadline) {
		b, err := os.ReadFile(pidFile)
		if err == nil && len(b) > 0 {
			for _, c := range b {
				if c >= '0' && c <= '9' {
					pid = pid*10 + int(c-'0')
				}
			}
			if pid > 0 {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	if pid <= 0 {
		t.Fatal("child process did not write pid")
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Kill(); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected error when child exited before initialize reply")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("newACPSession blocked after child process exited with grandchild holding stdout")
	}
}

func TestHandshakeTimeoutReturnsErrorWhenServerSilent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix shell child process test")
	}

	origTimeout := handshakeTimeout
	handshakeTimeout = 100 * time.Millisecond
	defer func() { handshakeTimeout = origTimeout }()

	dir := t.TempDir()
	script := filepath.Join(dir, "silent-acp.sh")
	body := "#!/bin/sh\nexec cat > /dev/null\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := newACPSession(context.Background(), acpSessionConfig{
			command: script,
			workDir: dir,
		})
		done <- err
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected error on silent server handshake timeout")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("newACPSession did not time out when server was silent")
	}
}
