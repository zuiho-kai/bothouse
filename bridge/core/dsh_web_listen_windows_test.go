//go:build windows

package core

import (
	"net"
	"os"
	"strconv"
	"testing"
)

// The self-heal must see a loopback listener and its owner on Windows, where there is no lsof.
func TestDSHWebListenersWindows(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
	found := false
	for _, p := range dshWebListeners() {
		found = found || p == port
	}
	if !found {
		t.Fatalf("port %s not among listeners %v", port, dshWebListeners())
	}
	if pid := pidListeningOnPort(port); pid != os.Getpid() {
		t.Fatalf("pidListeningOnPort(%s) = %d, want %d", port, pid, os.Getpid())
	}
	if pid := pidListeningOnPort("1"); pid != 0 {
		t.Fatalf("closed port: pid %d", pid)
	}
}
