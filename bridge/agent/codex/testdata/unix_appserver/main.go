//go:build unix

// A native app-server fixture: no real agent, credentials or network. It
// starts a worker in its own process group and an unrelated peer in a new
// session, then blocks on stdin like a stdio app-server.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "idle" {
		for {
			time.Sleep(time.Hour)
		}
	}

	writePID(os.Getenv("FIXTURE_PID_FILE"), os.Getpid())

	worker := exec.Command(os.Args[0], "idle")
	if err := worker.Start(); err != nil {
		panic(err)
	}
	writePID(os.Getenv("FIXTURE_WORKER_PID_FILE"), worker.Process.Pid)

	// The peer deliberately leaves the app-server's process group/session so
	// the test can assert that teardown does not kill unrelated processes.
	peer := exec.Command(os.Args[0], "idle")
	peer.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := peer.Start(); err != nil {
		panic(err)
	}
	writePID(os.Getenv("FIXTURE_PEER_PID_FILE"), peer.Process.Pid)

	// A real app-server stays alive when stdin closes. Exercise the explicit
	// process-tree cleanup instead of relying on EOF to end the process.
	buf := make([]byte, 1)
	for {
		if _, err := os.Stdin.Read(buf); err != nil {
			for {
				time.Sleep(time.Hour)
			}
		}
	}
}

func writePID(path string, pid int) {
	if path == "" {
		return
	}
	if err := os.WriteFile(path, []byte(fmt.Sprintf("%d\n", pid)), 0o600); err != nil {
		panic(err)
	}
}
