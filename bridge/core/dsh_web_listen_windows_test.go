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

// #2265: Antigravity's quota finds its CLI's loopback listener by pid; Windows has no lsof.
func TestLoopbackListenAddrsOfPIDWindows(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	want := ln.Addr().String()
	found := false
	for _, a := range LoopbackListenAddrsOfPID(os.Getpid()) {
		found = found || a == want
	}
	if !found {
		t.Fatalf("%s not among %v", want, LoopbackListenAddrsOfPID(os.Getpid()))
	}
	for _, a := range LoopbackListenAddrsOfPID(os.Getpid() + 1_000_000) {
		if a == want {
			t.Fatalf("listener reported for another pid")
		}
	}
}
