//go:build windows

package core

import (
	"context"
	"os"
	"os/exec"
	"testing"
)

// PR #1594 审查 A：Windows 上桥记下的是 cmd.exe（dsh.cmd 外壳），监听的是它的 node.exe 子进程。
// 认出两者靠读父进程；这里真起一个 cmd.exe，确认读出来的父进程是本测试进程。
func TestDSHWebParentPIDWindows(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "ping", "-n", "5", "127.0.0.1")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	if got := dshWebParentPID(context.Background(), cmd.Process.Pid); got != os.Getpid() {
		t.Fatalf("parent of cmd.exe %d = %d, want this test process %d", cmd.Process.Pid, got, os.Getpid())
	}
}
