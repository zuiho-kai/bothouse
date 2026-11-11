//go:build windows

package core

import (
	"context"
	"os"
	"os/exec"
	"strings"
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

// 同一个原因：PowerShell 查命令行在 CI 机器上会偶发读不到，改成系统接口直接读。
func TestDSHWebCommandLineNativeWindows(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "ping", "-n", "5", "127.0.0.1")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	line := dshWebCommandLineNative(cmd.Process.Pid)
	if !strings.Contains(line, "ping") {
		t.Fatalf("native command line of cmd.exe %d = %q, want it to contain ping", cmd.Process.Pid, line)
	}
	t.Logf("cmd.exe command line: %s", line)
}
