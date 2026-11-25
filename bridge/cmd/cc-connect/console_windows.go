//go:build windows

package main

import (
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/windows"
)

// ensureHiddenConsole gives a bothouse that runs without any console an invisible one.
//
// Every program the bridge starts — agent CLIs, git, PowerShell for cron jobs and hooks, the
// restarted bridge itself — is a console program. Started from a process with no console, each
// one makes Windows open a fresh console window for it (on Windows 11 a Windows Terminal window).
// The bridge has no console when the DSH plugin starts it in the background (detached, since
// #1662 11-15) and in the tray build, which frees the console a double-click gave it (#1495).
// Fixing that spawn by spawn (#477 codex, the wiki worker, #1997 restart) left every other spawn
// popping a window (外部用户 11-25 报告: 重启、cron、钩子调 PowerShell 都弹), so it is fixed once
// here: attached to a windowless console, every child shares it and none gets a window.
//
// The console comes from a cmd.exe started with CREATE_NO_WINDOW and waiting on its stdin; this
// process attaches to that console, then lets cmd.exe go. The console stays as long as a process is
// attached. With a console already (started from a terminal, or by a parent that gave it one)
// nothing changes. Std handles the process already has (the plugin's log file) stay as they are:
// os.Stdout and os.Stderr were read at startup.
func ensureHiddenConsole() {
	if hasConsole() {
		return
	}
	if err := attachHiddenConsole(); err != nil {
		slog.Warn("windows: no console, and making a hidden one failed; programs started from here may open console windows", "error", err)
	}
}

func attachHiddenConsole() error {
	shell := os.Getenv("ComSpec")
	if shell == "" {
		shell = filepath.Join(os.Getenv("SystemRoot"), "System32", "cmd.exe")
	}
	holder := exec.Command(shell, "/d", "/q", "/k")
	holder.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
	stdin, err := holder.StdinPipe()
	if err != nil {
		return err
	}
	if err := holder.Start(); err != nil {
		return err
	}
	// cmd.exe owns its console from CreateProcess on, and blocks reading the open stdin pipe.
	_, _, attachErr := windows.NewLazySystemDLL("kernel32.dll").NewProc("AttachConsole").Call(uintptr(holder.Process.Pid))
	_ = stdin.Close() // EOF: cmd.exe exits; the console stays, this process is attached to it
	_ = holder.Wait()
	if !hasConsole() {
		return attachErr
	}
	return nil
}
