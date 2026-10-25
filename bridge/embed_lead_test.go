package ccconnect_test

import (
	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/core"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestEmbeddedLeadInstallAndExecute(t *testing.T) {
	home := t.TempDir()
	for _, key := range []string{"CC_SESSION_KEY", "CC_SESSION", "DISCORD_BOT_TOKEN", "GATE_TEAM", "GATE_DIR", "GATE_LEAD_FILE"} {
		t.Setenv(key, "")
	}
	t.Setenv("HOME", home)
	t.Setenv("GATE_SETUP_DIR", filepath.Join(home, "setup"))
	t.Setenv("BOARD_DIR", filepath.Join(home, "board"))
	old := core.LeadToolFS
	core.LeadToolFS = ccconnect.LeadToolFiles
	t.Cleanup(func() { core.LeadToolFS = old })
	work := filepath.Join(home, "role")
	os.MkdirAll(work, 0755)
	persona := core.PersonaFilePath("codex", work)
	if err := os.WriteFile(persona, []byte("Keep my instructions.\n"), 0644); err != nil {
		t.Fatal(err)
	}
	var result map[string]string
	for i := 0; i < 2; i++ {
		var err error
		result, _, err = core.InstallLeadTools(filepath.Join(home, "data"), work, "codex", false)
		if err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(persona)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "Keep my instructions.") || strings.Count(string(data), "<!-- bothouse:lead-tools -->") != 1 {
		t.Fatalf("persona: %s", data)
	}
	bin := result["tools_dir"]
	for _, name := range []string{"board", "later", "safe-restart", "lead", "d10", "d10-fire", "t10", "ws-forward", "ws-handoff", "ws-up", "iso-check", "rehearse-copy"} {
		p := filepath.Join(bin, name)
		info, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0111 == 0 {
			t.Fatalf("not executable: %s", p)
		}
	}
	run := func(name string, args ...string) string {
		t.Helper()
		out, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %v: %s", name, err, out)
		}
		return string(out)
	}
	id := strings.TrimSpace(run("board", "add", "task", "-", "doing", "role"))
	run("board", "done", id, "2", "regression")
	report := run("board", "rework")
	if !strings.Contains(report, "regression：2 次") {
		t.Fatalf("report: %s", report)
	}
	run("lead", "--help")
	mock := filepath.Join(home, "timer")
	if err := os.WriteFile(mock, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/timer.args\"\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CC_BIN", mock)
	t.Setenv("CC_PROJECT", "test-role")
	t.Setenv("CC_SESSION", "test:isolated")
	back := strings.TrimSpace(run("board", "add", "comeback", "-", "doing", "role"))
	run("later", back, "10m", "continue")
	args, err := os.ReadFile(filepath.Join(home, "timer.args"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "test:isolated") {
		t.Fatalf("session lost: %s", args)
	}
	t.Setenv("CC_BIN", "/usr/bin/false")
	rb := strings.TrimSpace(run("board", "add", "rollback", "-", "doing", "role"))
	if out, err := exec.Command(filepath.Join(bin, "later"), rb, "10m", "continue").CombinedOutput(); err == nil {
		t.Fatalf("failure ignored: %s", out)
	}
	active := run("board")
	for _, line := range strings.Split(active, "\n") {
		// later 只改原条目的「下次看」：挂上的那条有，定时没挂上的那条改回原值（没有）；不新建条目
		if strings.Contains(line, "rollback") == strings.Contains(line, "下次看") && strings.TrimSpace(line) != "" {
			t.Fatalf("later next: %s", active)
		}
	}
	if strings.Count(active, "\n") != 2 {
		t.Fatalf("later added items: %s", active)
	}
}
