package core

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/creack/pty"
)

// SSHExecConfig configures remote shell execution, either direct SSH or via an interactive relay host
// (such as a restricted bastion/relay shell).
type SSHExecConfig struct {
	RemoteHost string
	RelayHost  string
	SSHArgs    []string
}

// ShellQuote safely single-quotes a string for POSIX sh/bash.
func ShellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// DetectComateUsername returns the logged-in iDev/Comate username from ~/.comate/login-user/
// (picking the most recently modified file), or "" if unavailable.
func DetectComateUsername() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	dir := filepath.Join(home, ".comate", "login-user")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var bestName string
	var bestMod time.Time
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if bestName == "" || info.ModTime().After(bestMod) {
			bestName = e.Name()
			bestMod = info.ModTime()
		}
	}
	return strings.TrimSpace(bestName)
}

func quoteRemotePath(path string) string {
	if path == "~" {
		return `"$HOME"`
	}
	if tail, ok := strings.CutPrefix(path, "~/"); ok {
		return `"$HOME/"` + ShellQuote(tail)
	}
	return ShellQuote(path)
}

// BuildRemoteZuluScript builds a POSIX bash script that:
//  1. Prepends bundled node from ~/.comate-server/bin/* to PATH (needed when remote PATH has no node)
//  2. Auto-discovers zulu in PATH, ~/.comate-server/.../zulu, or ~/.comate/zulu-cli/bin/zulu
//  3. Auto-detects remote --username from ~/.comate/login-user if not explicitly provided
//  4. Runs zulu with the given arguments.
func BuildRemoteZuluScript(cmd string, args []string, explicitUser string) string {
	return BuildRemoteZuluScriptWithEnv(cmd, args, explicitUser, nil)
}

// BuildRemoteZuluScriptWithEnv is like BuildRemoteZuluScript and also exports safe
// environment variables (such as COMATE_AGENT_EXECUTION_ACCESS_TOKEN, ZULU_PLATFORM_TOKEN,
// DODO_ZULU_BILLING_TOKEN) before executing zulu on the remote host.
func BuildRemoteZuluScriptWithEnv(cmd string, args []string, explicitUser string, extraEnv []string) string {
	var b strings.Builder
	b.WriteString("for d in \"$HOME\"/.comate-server/bin/*; do if [ -x \"$d/node\" ]; then export PATH=\"$d:$PATH\"; break; fi; done\n")
	if cmd == "" || cmd == "zulu" || strings.HasPrefix(cmd, "/Applications/") || strings.HasPrefix(cmd, "/Users/") {
		b.WriteString("Z=\"\"\n")
		b.WriteString("if command -v zulu >/dev/null 2>&1; then Z=\"$(command -v zulu)\"; fi\n")
		b.WriteString("if [ -z \"$Z\" ]; then for p in \"$HOME\"/.comate-server/bin/*/extensions/baiducomate.comate/dist/zulu-cli/bin/zulu \"$HOME\"/.comate/zulu-cli/bin/zulu; do if [ -x \"$p\" ]; then Z=\"$p\"; break; fi; done; fi\n")
		b.WriteString("if [ -z \"$Z\" ]; then echo 'zulu binary not found on remote host' >&2; exit 127; fi\n")
	} else {
		b.WriteString("Z=" + ShellQuote(cmd) + "\n")
	}

	for _, kv := range extraEnv {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || strings.TrimSpace(k) == "" {
			continue
		}
		// Never forward macOS CC_BIN / CC_DATA_DIR / local macOS paths onto remote Linux host.
		if k == "CC_BIN" || k == "CC_DATA_DIR" || strings.HasPrefix(v, "/Users/") {
			continue
		}
		b.WriteString("export " + ShellQuote(k+"="+v) + "\n")
	}

	b.WriteString("set --")
	hasUserFlag := false
	for i, arg := range args {
		hasUserFlag = hasUserFlag || arg == "--username"
		if i > 0 && args[i-1] == "--cwd" {
			b.WriteString(" " + quoteRemotePath(arg))
		} else {
			b.WriteString(" " + ShellQuote(arg))
		}
	}
	b.WriteByte('\n')
	if !hasUserFlag {
		if user := strings.TrimSpace(explicitUser); user != "" {
			b.WriteString("set -- \"$@\" --username " + ShellQuote(user) + "\n")
		} else {
			b.WriteString("U=\"$(ls -t \"$HOME/.comate/login-user\" 2>/dev/null | head -n 1)\"\n")
			b.WriteString("if [ -n \"$U\" ]; then set -- \"$@\" --username \"$U\"; fi\n")
		}
	}
	b.WriteString("exec \"$Z\" \"$@\" </dev/null\n")
	return b.String()
}

// resolveRemoteDucc locates the Comate CLI and falls back to Claude Code when available.
const resolveRemoteDucc = `D=""
if command -v ducc >/dev/null 2>&1; then D="$(command -v ducc)"; fi
if [ -z "$D" ] && [ -x "$HOME/.comate/baidu-cc/bin/ducc" ]; then D="$HOME/.comate/baidu-cc/bin/ducc"; fi
if [ -z "$D" ]; then
  for p in "$HOME"/.comate-server/extensions/baidu.baidu-cc-*/resources/native-binary/bin/ducc "$HOME"/.comate/extensions/baidu.baidu-cc-*/resources/native-binary/bin/ducc; do
    if [ -x "$p" ]; then D="$p"; break; fi
  done
fi
if [ -z "$D" ] && command -v claude >/dev/null 2>&1; then D="$(command -v claude)"; fi
`

// BuildRemoteDuccScript resolves the CLI, changes to the remote work directory,
// and launches the requested turn or model query.
func BuildRemoteDuccScript(cmd, workDir string, args []string, appendPrompt string, extraEnv []string) string {
	var b strings.Builder
	trimmed := strings.TrimSpace(cmd)
	switch {
	case trimmed == "" || trimmed == "ducc" || trimmed == "claude":
		b.WriteString(resolveRemoteDucc)
	case path.IsAbs(trimmed) && (path.Base(trimmed) == "ducc" || path.Base(trimmed) == "claude"):
		b.WriteString("if [ -x " + ShellQuote(trimmed) + " ]; then D=" + ShellQuote(trimmed) + "; else\n")
		b.WriteString(resolveRemoteDucc)
		b.WriteString("fi\n")
	default:
		b.WriteString("D=" + ShellQuote(trimmed) + "\n")
	}

	b.WriteString("if [ -z \"$D\" ]; then echo 'ducc/claude binary not found on remote host' >&2; exit 127; fi\n")

	if wd := strings.TrimSpace(workDir); wd != "" && wd != "." {
		b.WriteString("cd -- " + quoteRemotePath(wd) + " || exit 1\n")
	}

	b.WriteString("unset CLAUDECODE DISABLE_AUTO_COMPACT\n")
	b.WriteString("export CC_CONNECT_PERMISSION_HOOK_SKIP=1\n")
	for _, kv := range extraEnv {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || strings.TrimSpace(k) == "" {
			continue
		}
		// Never forward macOS CC_BIN / CC_DATA_DIR / provider local paths onto remote Linux host unless safe.
		if k == "CC_BIN" || k == "CC_DATA_DIR" || strings.HasPrefix(v, "/Users/") {
			continue
		}
		b.WriteString("export " + ShellQuote(k+"="+v) + "\n")
	}

	b.WriteString("exec \"$D\"")
	for _, a := range args {
		b.WriteString(" " + ShellQuote(a))
	}
	if appendPrompt != "" {
		// ducc's built-in append prompt conflicts with --append-system-prompt-file.
		b.WriteString(" --append-system-prompt " + ShellQuote(appendPrompt))
	}
	b.WriteString(" </dev/null\n")
	return b.String()
}

func randomMarkerHex() string {
	var buf [6]byte
	_, _ = rand.Read(buf[:])
	return hex.EncodeToString(buf[:])
}

// RunRemoteScript executes a bash script on cfg.RemoteHost (directly or via cfg.RelayHost)
// and collects its stdout/stderr.
func RunRemoteScript(ctx context.Context, cfg SSHExecConfig, script string) ([]byte, []byte, error) {
	if strings.TrimSpace(cfg.RelayHost) == "" {
		return runDirectSSHScript(ctx, cfg, script)
	}
	var out bytes.Buffer
	err := streamRelaySSHScript(ctx, cfg, script, func(line string) {
		out.WriteString(line)
		out.WriteByte('\n')
	})
	return out.Bytes(), nil, err
}

// StreamRemoteScript executes a bash script on cfg.RemoteHost (directly or via cfg.RelayHost)
// and calls onLine for each stdout line as it arrives.
func StreamRemoteScript(ctx context.Context, cfg SSHExecConfig, script string, onLine func(line string)) error {
	if strings.TrimSpace(cfg.RelayHost) == "" {
		return streamDirectSSHScript(ctx, cfg, script, onLine)
	}
	return streamRelaySSHScript(ctx, cfg, script, onLine)
}

func directSSHCommandArgs(cfg SSHExecConfig) []string {
	remoteCmd := "bash -l"
	args := make([]string, 0, len(cfg.SSHArgs)+8)
	args = append(args, "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10")
	for _, a := range cfg.SSHArgs {
		if t := strings.TrimSpace(a); t != "" {
			args = append(args, t)
		}
	}
	args = append(args, "--", strings.TrimSpace(cfg.RemoteHost), remoteCmd)
	return args
}

func runDirectSSHScript(ctx context.Context, cfg SSHExecConfig, script string) ([]byte, []byte, error) {
	cmd := exec.CommandContext(ctx, "ssh", directSSHCommandArgs(cfg)...)
	cmd.Stdin = strings.NewReader(script)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.Bytes(), stderr.Bytes(), err
}

func streamDirectSSHScript(ctx context.Context, cfg SSHExecConfig, script string, onLine func(line string)) error {
	cmd := exec.CommandContext(ctx, "ssh", directSSHCommandArgs(cfg)...)
	cmd.Stdin = strings.NewReader(script)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		if onLine != nil {
			onLine(sc.Text())
		}
	}
	if err := sc.Err(); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return fmt.Errorf("read SSH output: %w", err)
	}
	if err := cmd.Wait(); err != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return fmt.Errorf("%w: %s", err, msg)
		}
		return err
	}
	return nil
}

// streamRelaySSHScript connects to cfg.RelayHost over an interactive PTY (supporting relay shells
// that disable SSH -W / ProxyJump forwarding, such as Baidu BILS relay), then hops to cfg.RemoteHost
// with `ssh --silent -T` and frames stdout using unique begin/end markers.
func streamRelaySSHScript(ctx context.Context, cfg SSHExecConfig, script string, onLine func(line string)) error {
	relayHost := strings.TrimSpace(cfg.RelayHost)
	remoteHost := strings.TrimSpace(cfg.RemoteHost)
	if relayHost == "" || remoteHost == "" {
		return fmt.Errorf("both relay_host and remote_host are required")
	}

	tag := randomMarkerHex()
	beginMark := "__BH_BEGIN_" + tag + "__"
	endPrefix := "__BH_END_" + tag + "__:"
	wrapped := fmt.Sprintf("printf '\\n%%s\\n' %s\n(\n%s\n)\n_bh_ec=$?\nprintf '\\n%%s%%d\\n' %s \"$_bh_ec\"\n",
		ShellQuote(beginMark), script, ShellQuote(endPrefix))
	b64 := base64.StdEncoding.EncodeToString([]byte(wrapped))

	sshArgs := make([]string, 0, len(cfg.SSHArgs)+6)
	sshArgs = append(sshArgs, "-tt", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10")
	for _, a := range cfg.SSHArgs {
		if t := strings.TrimSpace(a); t != "" {
			sshArgs = append(sshArgs, t)
		}
	}
	sshArgs = append(sshArgs, "--", relayHost)

	cmd := exec.CommandContext(ctx, "ssh", sshArgs...)
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 40, Cols: 4096})
	if err != nil {
		return fmt.Errorf("start relay ssh pty: %w", err)
	}
	defer func() {
		_, _ = io.WriteString(ptmx, "exit\n")
		_ = ptmx.Close()
		_ = cmd.Wait()
	}()

	// Close PTY immediately if ctx cancels so blocked reads unblock promptly.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = ptmx.Close()
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
		case <-done:
		}
	}()

	// Bound the handshake even when the relay stops writing to the PTY.
	handshakeCtx, cancelHandshake := context.WithTimeout(ctx, 15*time.Second)
	defer cancelHandshake()
	stopHandshake := context.AfterFunc(handshakeCtx, func() { _ = ptmx.Close() })
	defer stopHandshake()
	reader := bufio.NewReaderSize(ptmx, 64*1024)
	if err := waitRelayPrompt(handshakeCtx, reader); err != nil {
		return err
	}

	// Send the payload via stdin in short lines so the relay's interactive
	// terminal can carry prompts larger than its canonical input limit.
	readyMark := "__BH_READY_" + tag + "__"
	inputEnd := "__BH_INPUT_END_" + tag + "__"
	receive := fmt.Sprintf("exec 3>&1; printf '\\n%%s\\n' %s; payload=$(while IFS= read -r line; do [ \"$line\" = %s ] && break; printf '%%s\\n' \"$line\"; printf '%%s\\n' %s >&3; done); printf '%%s\\n' \"$payload\" | base64 -d | bash -l",
		ShellQuote(readyMark), ShellQuote(inputEnd), ShellQuote(readyMark))
	hopCmd := fmt.Sprintf("ssh --silent -T -- %s %s\n", ShellQuote(remoteHost), ShellQuote(receive))
	if _, err := io.WriteString(ptmx, hopCmd); err != nil {
		return fmt.Errorf("write relay hop command: %w", err)
	}

	inBody := false
	ready := false
	offset := 0
	exitCode := -1
	var preBuf []string
	for {
		line, err := reader.ReadString('\n')
		cleaned := strings.TrimRight(line, "\r\n")
		if cleaned != "" || inBody {
			trimmed := strings.TrimSpace(cleaned)
			if !inBody {
				if trimmed == readyMark {
					if !ready {
						ready = true
						stopHandshake()
					}
					// Acknowledge each line before sending another. Some
					// relay PTYs discard input when their queue is full.
					chunk := inputEnd
					if offset < len(b64) {
						end := min(offset+240, len(b64))
						chunk = b64[offset:end]
						offset = end
					}
					if _, err := io.WriteString(ptmx, chunk+"\n"); err != nil {
						return fmt.Errorf("write relay payload: %w", err)
					}
					continue
				}
				if trimmed == beginMark {
					inBody = true
					continue
				}
				if !ready && len(preBuf) < 12 && trimmed != "" {
					preBuf = append(preBuf, trimmed)
				}
			} else {
				if strings.HasPrefix(trimmed, endPrefix) {
					ecStr := strings.TrimPrefix(trimmed, endPrefix)
					_, _ = fmt.Sscanf(ecStr, "%d", &exitCode)
					break
				}
				if onLine != nil {
					onLine(cleaned)
				}
			}
		}
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if !inBody {
				if err := handshakeCtx.Err(); err != nil {
					return fmt.Errorf("relay handshake to %s: %w", remoteHost, err)
				}
				return fmt.Errorf("relay hop to %s ended before output started (%v): %s", remoteHost, err, strings.Join(preBuf, " | "))
			}
			if err == io.EOF {
				break
			}
			return err
		}
	}

	if !inBody {
		return fmt.Errorf("relay hop to %s did not start: %s", remoteHost, strings.Join(preBuf, " | "))
	}
	if exitCode < 0 {
		return fmt.Errorf("remote command on %s ended without an exit status", remoteHost)
	}
	if exitCode > 0 {
		return fmt.Errorf("remote command on %s exited with status %d", remoteHost, exitCode)
	}
	return nil
}

func waitRelayPrompt(ctx context.Context, r *bufio.Reader) error {
	var buf strings.Builder
	tmp := make([]byte, 1024)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		n, err := r.Read(tmp)
		if n > 0 {
			buf.Write(tmp[:n])
			cur := strings.TrimRight(buf.String(), " \t\r\n")
			if strings.HasSuffix(cur, "$") || strings.HasSuffix(cur, "#") || strings.HasSuffix(cur, ">") {
				return nil
			}
			// Detect authentication failure quickly.
			lower := strings.ToLower(cur)
			if strings.Contains(lower, "permission denied") || strings.Contains(lower, "connection refused") || strings.Contains(lower, "operation timed out") {
				return fmt.Errorf("relay ssh failed: %s", strings.TrimSpace(cur))
			}
		}
		if err != nil {
			return fmt.Errorf("relay ssh closed before prompt (%w): %s", err, strings.TrimSpace(buf.String()))
		}
	}
}
