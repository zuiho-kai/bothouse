//go:build windows

package acp

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

// 沿用 bridge/agent/codex/proc_windows.go 的进程树清理方案。
func prepareCmdForKill(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= syscall.CREATE_NEW_PROCESS_GROUP | 0x08000000 // CREATE_NO_WINDOW
	cmd.SysProcAttr.HideWindow = true
}

func forceKillCmd(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	killCmd := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
	prepareCmdForKill(killCmd)
	output, err := killCmd.CombinedOutput()
	if err == nil {
		return nil
	}
	lower := bytes.ToLower(output)
	if bytes.Contains(lower, []byte("there is no running instance")) || bytes.Contains(lower, []byte("not found")) {
		return nil
	}
	if killErr := cmd.Process.Kill(); killErr == nil || errors.Is(killErr, os.ErrProcessDone) {
		return nil
	} else {
		return fmt.Errorf("taskkill failed: %w: %s; process kill fallback failed: %w", err, strings.TrimSpace(string(output)), killErr)
	}
}
