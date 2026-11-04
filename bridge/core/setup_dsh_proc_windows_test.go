//go:build windows

package core

import (
	"os"
	"os/exec"
	"testing"

	"golang.org/x/sys/windows"
)

func TestProcessAliveWindowsCurrentProcess(t *testing.T) {
	if !processAlive(os.Getpid()) {
		t.Fatal("running Windows process was reported dead")
	}
}

func TestProcessAliveWindowsExitedProcess(t *testing.T) {
	for _, code := range []string{"0", "259"} {
		t.Run(code, func(t *testing.T) {
			cmd := exec.Command("cmd.exe", "/c", "exit", code)
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			// Keep the process object alive after Wait so code 259 is tested
			// against a queryable exited process, rather than an absent PID.
			handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(cmd.Process.Pid))
			if err != nil {
				_ = cmd.Wait()
				t.Fatal(err)
			}
			defer windows.CloseHandle(handle)
			_ = cmd.Wait()
			if processAlive(cmd.Process.Pid) {
				t.Fatal("exited Windows process was reported alive")
			}
		})
	}
	for _, pid := range []int{0, -1, 1 << 30} {
		if processAlive(pid) {
			t.Fatalf("invalid pid %d was reported alive", pid)
		}
	}
}
