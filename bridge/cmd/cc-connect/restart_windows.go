//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"golang.org/x/sys/windows"
)

// Windows has no exec(2), so a restart cannot replace the process in place.
//
//   - Under the service (the Task Scheduler script sets CC_SUPERVISED=1) and in a child started
//     by the supervisor below (CC_RESTART_CHILD=1), a restart just exits with
//     restartExitCode; whoever started us starts the (possibly updated) binary again. No extra
//     process is left behind.
//   - In a console, the first cc-connect becomes the supervisor: it starts the new cc-connect as
//     a child, waits, and starts another one each time the child asks for a restart. At most one
//     parent + one child, however many restarts. Exiting right away instead would hand the
//     console back to the shell while the child keeps writing to it.
//
// restartExitCode — 来源：sysexits.h EX_TEMPFAIL（「临时失败，可重试」）；只在 cc-connect 自己
// 的父子进程和 daemon/windows.go 的服务脚本之间约定。
const (
	restartExitCode = 75
	envRestartChild = "CC_RESTART_CHILD"
	envSupervised   = "CC_SUPERVISED"
)

// restartByExit: started by the service script or by a supervising cc-connect. Read once at
// startup and removed from the environment, so agents and their children do not inherit it (a
// cc-connect they start would otherwise think it is supervised).
var restartByExit = func() bool {
	v := os.Getenv(envRestartChild) == "1" || os.Getenv(envSupervised) == "1"
	_ = os.Unsetenv(envRestartChild)
	_ = os.Unsetenv(envSupervised)
	return v
}()

func restartProcess(execPath string) error {
	if restartByExit {
		os.Exit(restartExitCode)
	}
	// Ctrl+C / Ctrl+Break reach every process on the console: the child shuts down cleanly, the
	// supervisor only waits for it. Notify (not Ignore): an ignored console event falls through
	// to Windows' default handler, which would kill the supervisor at once.
	signal.Notify(make(chan os.Signal, 1), os.Interrupt)
	for {
		cmd := exec.Command(execPath, os.Args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = os.Stdin
		cmd.Env = append(os.Environ(), envRestartChild+"=1")
		cmd.SysProcAttr = restartChildAttr(hasConsole())
		err := cmd.Run()
		code := 0
		var exitErr *exec.ExitError
		switch {
		case errors.As(err, &exitErr):
			code = exitErr.ExitCode()
		case err != nil:
			return err
		}
		if code != restartExitCode {
			os.Exit(code)
		}
	}
}

// reapInheritedChildren: Windows restarts start a new process, nothing is inherited (#1729).
func reapInheritedChildren() {}

// createNoWindow — 来源：Win32 process creation flags, CREATE_NO_WINDOW = 0x08000000.
const createNoWindow = 0x08000000

// hasConsole: this process is attached to a console, visible or not. The DSH plugin starts the
// bridge detached (no console), and the tray build frees the console it was given on a double-click.
// GetConsoleCP, not GetConsoleWindow: a windowless console (CI runners, conpty, a CREATE_NO_WINDOW
// parent) has no window but is still shared, and a child moved off it no longer gets the Ctrl+Break
// that stops the bridge — it kept the instance lock and the next start failed (#2197 windows-e2e).
// GetConsoleCP returns 0 only when no console is attached (Win32 docs).
func hasConsole() bool {
	cp, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetConsoleCP").Call()
	return cp != 0
}

// restartChildAttr: without a console of our own, the restarted child (a console-subsystem exe)
// would make Windows open a fresh console for it — on Windows 11 a Windows Terminal window titled
// with the exe path, popping up on every restart (外部用户 11-25 报告 #1997). Such a child gets
// an invisible console instead; its output still goes to the inherited log handles. With a console
// (started from a terminal) nothing changes: the child shares that terminal.
func restartChildAttr(console bool) *syscall.SysProcAttr {
	if console {
		return nil
	}
	return &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
}
