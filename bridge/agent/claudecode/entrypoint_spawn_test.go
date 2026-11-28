package claudecode

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// #2334: an API-key login must reach the CLI with its own sdk-cli entrypoint;
// Anthropic answers API-key requests from an unknown entrypoint with billing_error.
func TestSpawnEntrypointFollowsLogin(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX env fixture")
	}
	for _, c := range []struct{ key, want string }{{"", "bothouse"}, {"sk-ant-fixture", "sdk-cli"}} {
		t.Run(c.want, func(t *testing.T) {
			t.Setenv("ANTHROPIC_API_KEY", c.key)
			t.Setenv("BOTHOUSE_CLAUDE_ENTRYPOINT", "")
			dir := t.TempDir()
			script := filepath.Join(dir, "capture")
			// A local env fixture, not a model process.
			if err := os.WriteFile(script, []byte("#!/bin/sh\nprintf '%s' \"$CLAUDE_CODE_ENTRYPOINT\" > \"$CAPTURE_EP\"\n"), 0700); err != nil {
				t.Fatal(err)
			}
			capture := filepath.Join(dir, "ep")
			agent, err := New(map[string]any{"work_dir": dir, "cmd": script, "cc_data_dir": dir, "env": map[string]string{"CAPTURE_EP": capture}})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			sess, err := agent.StartSession(ctx, "")
			if err != nil {
				t.Fatal(err)
			}
			defer sess.Close()
			for range sess.Events() {
			}
			raw, err := os.ReadFile(capture)
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.TrimSpace(string(raw)); got != c.want {
				t.Fatalf("CLAUDE_CODE_ENTRYPOINT = %q, want %q", got, c.want)
			}
		})
	}
}
