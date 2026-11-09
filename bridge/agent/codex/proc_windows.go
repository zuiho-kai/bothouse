//go:build windows

package codex

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// createNoWindow is CREATE_NO_WINDOW (winbase.h): start the child without a
// console of its own.
//
// The bridge ships as a GUI-subsystem binary (-H=windowsgui, PE subsystem 2)
// while codex.exe is a console-subsystem binary (subsystem 3). Without this
// flag Windows allocates a brand-new console window for the app-server child,
// so every Codex session pops an extra terminal; closing that window delivers
// CTRL_CLOSE_EVENT to codex (exit 0xC000013A, STATUS_CONTROL_C_EXIT) and the
// turn dies mid-flight. Issue #477.
const createNoWindow = 0x08000000

// prepareAppServerCmd: the app-server child speaks JSON-RPC over pipes only,
// so it never needs a console of its own.
func prepareAppServerCmd(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= createNoWindow
	cmd.SysProcAttr.HideWindow = true
}

func prepareCmdForKill(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= syscall.CREATE_NEW_PROCESS_GROUP
}

func forceKillCmd(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	killCmd := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
	output, err := killCmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if bytes.Contains(bytes.ToLower(output), []byte("there is no running instance")) {
		return nil
	}
	if bytes.Contains(bytes.ToLower(output), []byte("not found")) {
		return nil
	}
	if killErr := cmd.Process.Kill(); killErr == nil || errors.Is(killErr, os.ErrProcessDone) {
		return nil
	} else {
		return fmt.Errorf("taskkill failed: %w: %s; process kill fallback failed: %w", err, processKillOutput(output), killErr)
	}
}

func processKillOutput(output []byte) string {
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" {
		return "(empty output)"
	}
	return trimmed
}

// codexOwnProcessGroup: no Unix process groups on Windows.
const codexOwnProcessGroup = false
