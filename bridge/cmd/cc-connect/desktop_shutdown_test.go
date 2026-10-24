package main

import (
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/config"
)

// Exercise the same in-process request used by tray Exit, including first-run
// setup mode, which has its own server and wait loop.
func TestDesktopShutdownStopsSetup(t *testing.T) {
	t.Setenv("CC_LOG_FILE", filepath.Join(t.TempDir(), "test.log"))
	t.Cleanup(func() {
		desktopShutdown = make(chan struct{})
		desktopShutdownOnce = sync.Once{}
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	dir := t.TempDir()
	cfg := &config.Config{DataDir: dir}
	cfg.Management.Port = port
	cfg.Management.Host = "127.0.0.1"
	cfg.Management.Token = "test-desktop-shutdown"
	released := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		runSetupOnly(cfg, filepath.Join(dir, "config.toml"), func() { close(released) })
	}()
	client := &http.Client{Timeout: 200 * time.Millisecond}
	endpoint := fmt.Sprintf("http://127.0.0.1:%d/login", port)
	ready := false
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		res, err := client.Get(endpoint)
		if err == nil {
			res.Body.Close()
			ready = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Repeated exit events must be safe as well.
	requestDesktopShutdown()
	requestDesktopShutdown()
	select {
	case <-done:
	case <-time.After(6 * time.Second):
		t.Fatal("tray exit did not finish setup server cleanup")
	}
	if !ready {
		t.Fatal("setup server did not become ready")
	}
	select {
	case <-released:
	default:
		t.Fatal("instance lock cleanup was not called")
	}
	client.CloseIdleConnections()
	if conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 200*time.Millisecond); err == nil {
		conn.Close()
		t.Fatal("management listener remains after tray exit")
	}
}
