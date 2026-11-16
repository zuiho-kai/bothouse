package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A bridge that comes back while the command waits is reached; a path with no socket fails at once.
func TestDialBridgeWaitsForARestart(t *testing.T) {
	dir, err := os.MkdirTemp("", "bd")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	sock := filepath.Join(dir, "api.sock")
	l, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	l.(*net.UnixListener).SetUnlinkOnClose(false)
	l.Close() // the socket file stays, nothing listens: connection refused

	old := bridgeDialWait
	bridgeDialWait = 5 * time.Second
	defer func() { bridgeDialWait = old }()
	go func() {
		time.Sleep(700 * time.Millisecond)
		os.Remove(sock)
		if l2, err := net.Listen("unix", sock); err == nil {
			defer l2.Close()
			if c, err := l2.Accept(); err == nil {
				c.Close()
			}
		}
	}()
	start := time.Now()
	c, err := dialBridge(context.Background(), sock)
	if err != nil {
		t.Fatalf("dial during a restart = %v, want connected once the bridge is back", err)
	}
	c.Close()
	if time.Since(start) < 500*time.Millisecond {
		t.Fatal("connected before the listener was back")
	}

	start = time.Now()
	if _, err := dialBridge(context.Background(), filepath.Join(dir, "none.sock")); err == nil || time.Since(start) > time.Second {
		t.Fatalf("no socket file: err %v after %s, want an error at once", err, time.Since(start))
	}
}
