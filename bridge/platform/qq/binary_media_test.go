package qq

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #1749: exercise the configured, built CLI, not just a linked Engine. The
// ACP process is this test binary; OneBot and model control are loopback peers.
func TestQQBinaryMedia(t *testing.T) {
	binary := os.Getenv("QQ_RESILIENCE_BINARY")
	if binary == "" {
		t.Skip("run tests/qq-resilience/run.sh --binary <built-bothouse>")
	}
	const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEUlEQVR4nAAEAPv/Av8AAAMAAwkBAvk/Y+MAAAAASUVORK5CYII="
	image, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	for _, native := range []bool{false, true} {
		t.Run(fmt.Sprint(native), func(t *testing.T) {
			f := newFaultUpstream(t)
			script := qqACPScript{ImageData: image}
			if native {
				script = qqACPScript{NativeImageData: image}
			}
			control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/turn" {
					_ = json.NewEncoder(w).Encode(script)
				}
			}))
			t.Cleanup(control.Close)
			dir := t.TempDir()
			config := fmt.Sprintf(`data_dir = %q
language = "en"
[management]
enabled = false
[display]
mode = "compact"
thinking_messages = false
tool_messages = false
reply_footer = false
[stream_preview]
enabled = false
[[projects]]
name = "qq-media"
reply_footer = false
[projects.agent]
type = "acp"
[projects.agent.options]
cmd = %q
args = ["-test.run=^TestQQFaultACPProcess$"]
work_dir = %q
[projects.agent.options.env]
QQ_FAULT_ACP = "1"
QQ_FAULT_CONTROL = %q
QQ_FAULT_SOCKET = %q
[[projects.platforms]]
type = "qq"
[projects.platforms.options]
ws_url = %q
allow_from = "*"
`, dir, os.Args[0], dir, control.URL, filepath.Join(dir, "run", "api.sock"), "ws"+strings.TrimPrefix(f.ts.URL, "http"))
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
			deadline := time.Now().Add(10 * time.Second)
			for {
				data, _ := os.ReadFile(logPath)
				if strings.Contains(string(data), "engine started") {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("candidate did not finish isolated startup")
				}
				time.Sleep(10 * time.Millisecond)
			}
			f.push(privateMessage(111, 1, textSegment("return only the image")))
			deadline = time.Now().Add(10 * time.Second)
			for {
				data, _ := os.ReadFile(logPath)
				text := string(data)
				if strings.Contains(text, "silent reply suppressed") || strings.Contains(text, "agent error") {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("candidate media turn did not finish")
				}
				time.Sleep(10 * time.Millisecond)
			}
			f.mu.Lock()
			calls := append([]map[string]any(nil), f.sent["send_private_msg"]...)
			f.mu.Unlock()
			if len(calls) != 1 || jsonInt64(calls[0], "user_id") != 111 || !strings.Contains(mustJSON(calls[0]["message"]), "base64://"+encoded) {
				t.Fatalf("candidate lost media or sent an extra error: %s", mustJSON(calls))
			}
			t.Logf("candidate CLI native=%v: image delivered once with original bytes; empty ACP text added no message", native)
		})
	}
}
