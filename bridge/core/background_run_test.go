package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// Run the installed CLI with the exact role env, then read it through the watcher.
func TestBackgroundRunUsesRoleDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("bgrun is a POSIX collaboration helper")
	}
	if _, err := testutil.LookPathReal("python3"); err != nil {
		t.Skip("no real python3")
	}
	e := NewEngine("isolated", &stubAgent{}, nil, "", LangEnglish)
	data, _ := roleEnvFixture(t, e)
	cmd := exec.Command(filepath.Join(data, "collaboration", "lead", "bgrun"), "watch-path", "5",
		"/bin/sh", "-c", "sleep 1; echo watcher-visible")
	cmd.Env = MergeEnv(os.Environ(), e.roleSessionEnv("test:workspace"))
	cmd.Env = MergeEnv(cmd.Env, []string{"HOME=" + t.TempDir(), "CC_BIN=/usr/bin/true"})
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("bgrun: %v: %s", err, out)
	}
	run := e.watchBackgroundRun("test:workspace")
	if run == "" {
		t.Fatalf("watcher cannot see CLI run: %s", out)
	}
	dir := filepath.Join(e.backgroundRunsDir(), run)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if raw, err := os.ReadFile(filepath.Join(dir, "wake")); err == nil && strings.Contains(string(raw), "叫醒成功") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("missing wake receipt")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "exit")); err != nil || strings.TrimSpace(string(raw)) != "0" {
		t.Fatalf("exit = %q, err = %v", raw, err)
	}
	if got := e.watchBackgroundRun("test:workspace"); got != "" {
		t.Fatalf("completed run still blocks watcher: %s", got)
	}
}
