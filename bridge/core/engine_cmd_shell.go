package core

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// quickFinishTimeout is how long to wait before assuming the command is long-running.
const quickFinishTimeout = 500 * time.Millisecond

// shellExecCommand builds an exec.Cmd for running command via the given shell.
// For PowerShell/pwsh, extra flags (-NoProfile, -ExecutionPolicy Bypass) are
// added automatically. If shellProfile is non-empty, it is prepended to the command
// with a newline separator (useful for sourcing shell profiles).
func shellExecCommand(ctx context.Context, shell, flag, shellProfile, command string) *exec.Cmd {
	if shellProfile != "" {
		command = shellProfile + "\n" + command
	}
	base := strings.ToLower(filepath.Base(shell))
	if strings.HasPrefix(base, "powershell") || strings.HasPrefix(base, "pwsh") {
		return exec.CommandContext(ctx, shell, "-NoProfile", "-ExecutionPolicy", "Bypass", flag, command)
	}
	return exec.CommandContext(ctx, shell, flag, command)
}

func defaultShell() string {
	if runtime.GOOS == "windows" {
		return "powershell.exe"
	}
	return "sh"
}

func defaultShellFlag() string {
	if runtime.GOOS == "windows" {
		return "-Command"
	}
	return "-c"
}

// runShellWithProgress executes a shell command with live progress feedback.
// Strategy: start the command, wait 500ms. If it finishes within that window,
// just send the result directly (no intermediate messages). If it's still running,
// send a progress message and keep updating until completion.
func (e *Engine) runShellWithProgress(p Platform, replyCtx any, command string, workDir string, timeout time.Duration, maxOutput int) error {
	cmdLabel := truncateStr(command, 60)

	ctx, cancel := context.WithTimeout(e.ctx, timeout)
	defer cancel()

	cmd := shellExecCommand(ctx, e.shell, e.shellFlag, e.shellProfile, command)
	cmd.Dir = workDir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		errMsg := fmt.Sprintf("failed to start command: %v", err)
		e.reply(p, replyCtx, fmt.Sprintf("❌ `%s`\n```\n%s\n```", cmdLabel, errMsg))
		return err
	}

	// Read stdout and stderr concurrently
	var mu sync.Mutex
	var buf bytes.Buffer
	doneCh := make(chan struct{})
	var cmdWaitErr error

	readPipe := func(r io.Reader) {
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 0, 64*1024), 64*1024)
		for scanner.Scan() {
			mu.Lock()
			if buf.Len() > 0 {
				buf.WriteByte('\n')
			}
			buf.WriteString(scanner.Text())
			mu.Unlock()
		}
	}

	go func() {
		// Pipes must be fully drained before cmd.Wait() per Go API contract.
		var pipeWg sync.WaitGroup
		pipeWg.Add(2)
		go func() { defer pipeWg.Done(); readPipe(stdout) }()
		go func() { defer pipeWg.Done(); readPipe(stderr) }()
		pipeWg.Wait()
		cmdWaitErr = cmd.Wait()
		close(doneCh)
	}()

	// Wait a bit to see if the command finishes quickly
	select {
	case <-doneCh:
		// Command finished within the quick window — send result directly
		return e.finishShellCmd(p, replyCtx, cmd, &mu, &buf, cmdLabel, maxOutput, false, cmdWaitErr)
	case <-ctx.Done():
		// Timeout before even the quick window elapsed (very short timeout)
		killAndWait(cmd, doneCh)
		mu.Lock()
		output := buf.String()
		mu.Unlock()
		e.send(p, replyCtx, e.formatShellTimeout(cmdLabel, output, maxOutput))
		return fmt.Errorf("command timed out after %s", timeout)
	case <-time.After(quickFinishTimeout):
		// Still running — fall through to progress mode
	}

	// Command is long-running. Try to send a progress message.
	var previewHandle any
	var useUpdate bool
	if _, ok := p.(MessageUpdater); ok {
		if starter, ok := p.(PreviewStarter); ok {
			mu.Lock()
			output := buf.String()
			mu.Unlock()
			progressMsg := e.formatShellProgress(cmdLabel, output, maxOutput)
			handle, err := starter.SendPreviewStart(e.ctx, replyCtx, progressMsg)
			if err == nil && handle != nil {
				previewHandle = handle
				useUpdate = true
			}
		}
	}

	if !useUpdate {
		// Platform doesn't support in-place updates — send a status message
		e.send(p, replyCtx, fmt.Sprintf("⏳ `%s`", cmdLabel))
	}

	// Periodic updates (only for platforms that support UpdateMessage)
	updateDone := make(chan struct{})
	if useUpdate {
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					mu.Lock()
					output := buf.String()
					mu.Unlock()
					msg := e.formatShellProgress(cmdLabel, output, maxOutput)
					_ = updaterFor(p).UpdateMessage(e.ctx, previewHandle, msg)
				case <-updateDone:
					return
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	// Wait for completion or timeout
	select {
	case <-doneCh:
		close(updateDone)
		return e.finishShellCmd(p, replyCtx, cmd, &mu, &buf, cmdLabel, maxOutput, useUpdate, previewHandle, cmdWaitErr)
	case <-ctx.Done():
		close(updateDone)
		killAndWait(cmd, doneCh)
		mu.Lock()
		output := buf.String()
		mu.Unlock()
		timeoutMsg := e.formatShellTimeout(cmdLabel, output, maxOutput)
		if useUpdate {
			_ = updaterFor(p).UpdateMessage(e.ctx, previewHandle, timeoutMsg)
		} else {
			e.send(p, replyCtx, timeoutMsg)
		}
		return fmt.Errorf("command timed out after %s", timeout)
	}
}

func truncateRunes(s string, max int) string {
	if max < 4 {
		max = 4
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max-3]) + "..."
}

func (e *Engine) finishShellCmd(p Platform, replyCtx any, cmd *exec.Cmd, mu *sync.Mutex, buf *bytes.Buffer, cmdLabel string, maxOutput int, opts ...any) error {
	var waitErr error
	// Extract waitErr from opts if provided as the last error argument.
	for _, o := range opts {
		if err, ok := o.(error); ok {
			waitErr = err
		}
	}

	mu.Lock()
	output := buf.String()
	mu.Unlock()

	exitCode := cmd.ProcessState.ExitCode()
	exitOK := exitCode == 0

	display := strings.TrimSpace(output)
	if display == "" && exitOK {
		display = "(no output)"
	}
	display = truncateRunes(display, maxOutput)

	var finalMsg string
	if exitOK {
		finalMsg = fmt.Sprintf("✅ `%s`\n```\n%s\n```", cmdLabel, display)
	} else {
		// Prefer the wait error message when we have no captured output,
		// since it often contains the actual failure reason.
		if display == "" && waitErr != nil {
			display = truncateRunes(waitErr.Error(), maxOutput)
		}
		finalMsg = fmt.Sprintf("❌ `%s` (exit code %d)\n```\n%s\n```", cmdLabel, exitCode, display)
	}

	// opts: [useUpdate bool, previewHandle any]
	if len(opts) >= 2 {
		if useUpdate, ok := opts[0].(bool); ok && useUpdate {
			if handle := opts[1]; handle != nil {
				_ = updaterFor(p).UpdateMessage(e.ctx, handle, finalMsg)
				if !exitOK {
					return fmt.Errorf("exit code %d", exitCode)
				}
				return nil
			}
		}
	}

	// No in-place update available, or command finished quickly — send final reply
	e.reply(p, replyCtx, finalMsg)
	if !exitOK {
		return fmt.Errorf("exit code %d", exitCode)
	}
	return nil
}

func (e *Engine) formatShellProgress(cmdLabel, output string, maxOutput int) string {
	display := truncateRunes(output, maxOutput)
	return fmt.Sprintf("⏳ `%s`\n```\n%s\n```", cmdLabel, display)
}

func (e *Engine) formatShellTimeout(cmdLabel, output string, maxOutput int) string {
	display := truncateRunes(output, maxOutput)
	return fmt.Sprintf("⚠️ `%s` (timeout)\n```\n%s\n```", cmdLabel, display)
}

func killAndWait(cmd *exec.Cmd, doneCh <-chan struct{}) {
	if cmd.Process != nil {
		if cmd.Cancel != nil {
			_ = cmd.Cancel()
		} else {
			_ = cmd.Process.Kill()
		}
	}
	<-doneCh
}

func updaterFor(p Platform) MessageUpdater {
	return p.(MessageUpdater)
}

func (e *Engine) cmdShell(p Platform, msg *Message, raw string) {
	// Strip the command prefix ("/shell ", "/sh ", "/exec ", "/run ")
	shellCmd := raw
	for _, prefix := range []string{"/shell ", "/sh ", "/exec ", "/run "} {
		if strings.HasPrefix(strings.ToLower(raw), prefix) {
			shellCmd = raw[len(prefix):]
			break
		}
	}
	shellCmd = strings.TrimSpace(shellCmd)

	if shellCmd == "" {
		e.reply(p, msg.ReplyCtx, "Usage: /shell [--timeout <seconds>] <command>\nExample: /shell ls -la\nExample: /shell --timeout 300 npm install")
		return
	}

	// Parse optional --timeout at the beginning of the command.
	// Placed before the actual command so no CLI tool's own --timeout can conflict.
	// Supported: /shell --timeout 300 npm install, ! --timeout 300 npm install
	timeout := 60 * time.Second
	if strings.HasPrefix(shellCmd, "--timeout ") {
		rest := shellCmd[len("--timeout "):]
		if idx := strings.IndexByte(rest, ' '); idx > 0 {
			if secs, err := strconv.Atoi(rest[:idx]); err == nil && secs > 0 {
				timeout = time.Duration(secs) * time.Second
				shellCmd = strings.TrimSpace(rest[idx:])
			}
		}
	}

	agent, _, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}
	workDir := e.commandWorkDir(agent, msg)
	if workDir == "" {
		workDir, _ = os.Getwd()
	}

	go func() { _ = e.runShellWithProgress(p, msg.ReplyCtx, shellCmd, workDir, timeout, 4000) }()
}

func (e *Engine) cmdDiff(p Platform, msg *Message, raw string) {
	// Parse optional target: /diff [target]
	diffTarget := ""
	if strings.HasPrefix(strings.ToLower(raw), "/diff ") {
		diffTarget = strings.TrimSpace(raw[6:])
	}

	if strings.HasPrefix(diffTarget, "-") {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgError), "diff target must not start with '-'"))
		return
	}

	// Resolve working directory (same pattern as cmdShell)
	var workDir string
	if e.multiWorkspace {
		channelKey := effectiveWorkspaceChannelKey(msg)
		if b, _, usable := e.lookupEffectiveWorkspaceBinding(channelKey); usable {
			workDir = normalizeWorkspacePath(b.Workspace)
		}
	}
	if workDir == "" {
		if wd, ok := e.agent.(interface{ GetWorkDir() string }); ok {
			workDir = wd.GetWorkDir()
		}
	}
	if workDir == "" {
		workDir, _ = os.Getwd()
	}

	go func() {
		ctx, cancel := context.WithTimeout(e.ctx, 60*time.Second)
		defer cancel()

		// Get current branch name and short commit ID
		branchCmd := exec.CommandContext(ctx, "git", "rev-parse", "--abbrev-ref", "HEAD")
		branchCmd.Dir = workDir
		branchOut, _ := branchCmd.Output()
		currentBranch := strings.TrimSpace(string(branchOut))
		if currentBranch == "" {
			currentBranch = "unknown"
		}

		commitCmd := exec.CommandContext(ctx, "git", "rev-parse", "--short", "HEAD")
		commitCmd.Dir = workDir
		commitOut, _ := commitCmd.Output()
		commitID := strings.TrimSpace(string(commitOut))
		if commitID == "" {
			commitID = "0000000"
		}

		gitArgs := []string{"diff"}
		if diffTarget != "" {
			gitArgs = append(gitArgs, "--", diffTarget)
		}
		gitCmd := exec.CommandContext(ctx, "git", gitArgs...)
		gitCmd.Dir = workDir
		diffOutput, err := gitCmd.Output()

		if ctx.Err() == context.DeadlineExceeded {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCommandTimeout), "git diff"))
			return
		}
		if err != nil && len(diffOutput) == 0 {
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
			return
		}

		target := diffTarget
		if target == "" {
			target = "HEAD"
		}
		if len(strings.TrimSpace(string(diffOutput))) == 0 {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgDiffEmpty), target))
			return
		}

		// Try diff2html + FileSender
		if fileSender, ok := p.(FileSender); ok {
			title := fmt.Sprintf("%s vs %s", currentBranch, target)
			htmlData, err := e.diff2html(ctx, diffOutput, workDir, title)
			if err == nil {
				fileName := fmt.Sprintf("%s-%s.html", currentBranch, commitID)
				if err := e.waitOutgoing(p); err != nil {
					slog.Warn("outgoing rate limit", "platform", p.Name(), "error", err)
				}
				if err := fileSender.SendFile(e.ctx, msg.ReplyCtx, FileAttachment{
					MimeType: "text/html", Data: htmlData, FileName: fileName,
				}); err == nil {
					return
				}
			}
			if errors.Is(err, exec.ErrNotFound) {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDiffNoDiff2HTML))
			}
		}

		// Fallback: plain text diff
		result := strings.TrimSpace(string(diffOutput))
		if runes := []rune(result); len(runes) > 4000 {
			result = string(runes[:3997]) + "..."
		}
		e.reply(p, msg.ReplyCtx, "```diff\n"+result+"\n```")
	}()
}

func (e *Engine) diff2html(ctx context.Context, diff []byte, workDir, title string) ([]byte, error) {
	if _, err := exec.LookPath("diff2html"); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "diff2html", "-i", "stdin", "-o", "stdout", "--title", title)
	cmd.Dir = workDir
	cmd.Stdin = bytes.NewReader(diff)
	return cmd.Output()
}

// dirApply applies /dir mutations (same semantics as cmdDir). sessionKey is used for GetOrCreateActive.
// On failure returns a non-empty errMsg; on success returns ("", successMsg) for plain-text replies.
func (e *Engine) dirApply(agent Agent, sessions *SessionManager, interactiveKey, sessionKey string, args []string) (errMsg, successMsg string) {
	switcher, ok := agent.(WorkDirSwitcher)
	if !ok {
		return e.i18n.T(MsgDirNotSupported), ""
	}
	currentDir := switcher.GetWorkDir()

	if len(args) == 1 {
		switch strings.ToLower(strings.TrimSpace(args[0])) {
		case "reset":
			baseDir := strings.TrimSpace(e.baseWorkDir)
			if baseDir == "" {
				baseDir = currentDir
			}
			if baseDir == "" {
				baseDir, _ = os.Getwd()
			}
			if absDir, err := filepath.Abs(baseDir); err == nil {
				baseDir = absDir
			}

			if !e.multiWorkspace {
				switcher.SetWorkDir(baseDir)
			}
			e.cleanupInteractiveState(interactiveKey)

			s := sessions.GetOrCreateActive(sessionKey)
			s.SetAgentSessionID("", "")
			s.ClearHistory()
			sessions.Save()

			if e.projectState != nil {
				if e.multiWorkspace {
					e.projectState.ClearWorkspaceDirOverride(interactiveKey)
				} else {
					e.projectState.ClearWorkDirOverride()
				}
				e.projectState.Save()
			}
			if e.dirHistory != nil {
				e.dirHistory.Add(e.name, baseDir)
			}

			return "", e.i18n.Tf(MsgDirReset, baseDir)
		}
	}

	arg := strings.Join(args, " ")
	var newDir string

	if idx, err := strconv.Atoi(strings.TrimSpace(arg)); err == nil && idx > 0 {
		if e.dirHistory != nil {
			newDir = e.dirHistory.Get(e.name, idx)
			if newDir == "" {
				return e.i18n.Tf(MsgDirInvalidIndex, idx), ""
			}
		} else {
			return e.i18n.T(MsgDirNoHistory), ""
		}
	} else if arg == "-" {
		if e.dirHistory != nil {
			newDir = e.dirHistory.Previous(e.name)
			if newDir == "" {
				return e.i18n.T(MsgDirNoPrevious), ""
			}
		} else {
			return e.i18n.T(MsgDirNoHistory), ""
		}
	} else {
		newDir = filepath.Clean(arg)
		if strings.HasPrefix(newDir, "~") {
			if homeDir, err := os.UserHomeDir(); err == nil {
				newDir = filepath.Join(homeDir, strings.TrimPrefix(newDir, "~"))
			}
		} else if !filepath.IsAbs(newDir) {
			baseDir := currentDir
			if baseDir == "" {
				baseDir, _ = os.Getwd()
			}
			newDir = filepath.Join(baseDir, newDir)
		}
	}
	if absDir, err := filepath.Abs(newDir); err == nil {
		newDir = absDir
	}

	info, err := os.Stat(newDir)
	if err != nil || !info.IsDir() {
		return e.i18n.Tf(MsgDirInvalidPath, newDir), ""
	}

	if !e.multiWorkspace {
		switcher.SetWorkDir(newDir)
	}
	e.cleanupInteractiveState(interactiveKey)

	s := sessions.GetOrCreateActive(sessionKey)
	s.SetAgentSessionID("", "")
	s.ClearHistory()
	sessions.Save()

	if e.dirHistory != nil {
		e.dirHistory.Add(e.name, newDir)
	}
	if e.projectState != nil {
		if e.multiWorkspace {
			e.projectState.SetWorkspaceDirOverride(interactiveKey, newDir)
		} else {
			e.projectState.SetWorkDirOverride(newDir)
		}
		e.projectState.Save()
	}

	return "", e.i18n.Tf(MsgDirChanged, newDir)
}

func (e *Engine) cmdDir(p Platform, msg *Message, args []string) {
	agent, sessions, interactiveKey, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}
	switcher, ok := agent.(WorkDirSwitcher)
	if !ok {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDirNotSupported))
		return
	}

	currentDir := switcher.GetWorkDir()

	if len(args) == 0 {
		if supportsCards(p) {
			e.replyWithCard(p, msg.ReplyCtx, e.renderDirCardSafe(msg.SessionKey, 1))
			return
		}
		var sb strings.Builder
		sb.WriteString(e.i18n.Tf(MsgDirCurrent, currentDir))

		if e.dirHistory != nil {
			history := e.dirHistory.List(e.name)
			if len(history) > 0 {
				sb.WriteString("\n\n")
				sb.WriteString(e.i18n.T(MsgDirHistoryTitle))
				for i, dir := range history {
					marker := "◻"
					if dir == currentDir {
						marker = "▶"
					}
					sb.WriteString(fmt.Sprintf("\n  %s %d. %s", marker, i+1, dir))
				}
				sb.WriteString("\n\n")
				sb.WriteString(e.i18n.T(MsgDirHistoryHint))
			}
		}
		e.reply(p, msg.ReplyCtx, sb.String())
		return
	}

	if len(args) == 1 {
		switch strings.ToLower(strings.TrimSpace(args[0])) {
		case "help", "-h", "--help":
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgDirUsage))
			return
		}
	}

	errMsg, successMsg := e.dirApply(agent, sessions, interactiveKey, msg.SessionKey, args)
	if errMsg != "" {
		e.reply(p, msg.ReplyCtx, errMsg)
		return
	}
	if supportsCards(p) {
		e.replyWithCard(p, msg.ReplyCtx, e.renderDirCardSafe(msg.SessionKey, 1))
		return
	}
	e.reply(p, msg.ReplyCtx, successMsg)
}
