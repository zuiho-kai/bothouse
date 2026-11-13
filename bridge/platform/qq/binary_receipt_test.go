package qq

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt-in candidate-binary check: real config/startup/CLI/local API/QQ transport,
// with a loopback OneBot peer. The package TestMain supplies an isolated HOME.
func TestQQBinary(t *testing.T) {
	binary := os.Getenv("QQ_RESILIENCE_BINARY")
	if binary == "" {
		t.Skip("run tests/qq-resilience/run.sh --binary <built-bothouse>")
	}
	f := newFaultUpstream(t)
	f.dropAfterRead = func(action string, n int) bool { return action == "send_group_msg" && n == 1 }
	dir := t.TempDir()
	config := fmt.Sprintf(`data_dir = %q
language = "en"
[management]
enabled = false
[[projects]]
name = "qq-fi"
[projects.agent]
type = "acp"
[projects.agent.options]
cmd = %q
args = ["-test.run=^TestQQFaultACPProcess$"]
work_dir = %q
[projects.agent.options.env]
QQ_FAULT_ACP = "1"
[[projects.platforms]]
type = "qq"
[projects.platforms.options]
ws_url = %q
allow_from = "*"
`, dir, os.Args[0], dir, "ws"+strings.TrimPrefix(f.ts.URL, "http"))
	configPath := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(dir, "candidate.log")
	log, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, binary, "--config", configPath)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "BOTHOUSE_TEST=1", "BOTHOUSE_TRAY=off")
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		_ = log.Close()
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	t.Cleanup(func() {
		_ = cmd.Process.Signal(os.Interrupt)
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			cancel()
			<-done
		}
		_ = log.Close()
		if t.Failed() {
			data, _ := os.ReadFile(logPath)
			t.Log(string(data))
		}
	})
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(dir, "run", "api.sock")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("candidate did not open its isolated local API")
		}
		time.Sleep(10 * time.Millisecond)
	}
	send := func(text string) ([]byte, error) {
		callCtx, stop := context.WithTimeout(ctx, 3*time.Second)
		defer stop()
		call := exec.CommandContext(callCtx, binary, "send", "--data-dir", dir, "-p", "qq-fi", "-s", "qq:g:42", "--message", text)
		return call.CombinedOutput()
	}
	started := time.Now()
	output, err := send("candidate-disconnect")
	if err == nil || !strings.Contains(string(output), "delivery unknown") {
		t.Fatalf("candidate CLI did not surface the lost receipt promptly: %v, %s", err, output)
	}
	t.Logf("built CLI returned unknown delivery in %s", time.Since(started).Round(time.Millisecond))
	deadline = time.Now().Add(5 * time.Second)
	for {
		f.mu.Lock()
		connected := len(f.conns) >= 2
		f.mu.Unlock()
		if connected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("candidate did not reconnect")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := f.count("send_group_msg"); got != 1 {
		t.Fatalf("candidate replayed unknown delivery: %d attempts", got)
	}
	if output, err := send("candidate-after-reconnect"); err != nil {
		t.Fatalf("candidate CLI did not recover for a new message: %v, %s", err, output)
	}
	if got := f.count("send_group_msg"); got != 2 {
		t.Fatalf("candidate sends = %d, want two distinct messages", got)
	}
	t.Log("built config -> CLI send -> local API -> OneBot: failure once, reconnect, next message succeeds")
}
