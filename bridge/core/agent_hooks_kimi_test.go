package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentHookKimi(t *testing.T) {
	useRepoHooks(t)
	wd, data := t.TempDir(), t.TempDir()
	o := AgentHookOptions{CLI: "kimi", WorkDir: wd, DataDir: data, Lang: "en"}
	path := AgentHookSettingsPath("kimi", wd)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("default_model = \"test-model\"\n[[hooks]]\nevent = \"Stop\"\ncommand = \"user-hook\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := EnableAgentHooks(o); err != nil {
			t.Fatal(err)
		}
	}
	c, rules, err := readKimiHooks(wd)
	if err != nil {
		t.Fatal(err)
	}
	if c["default_model"] != "test-model" || len(rules) != 2 {
		t.Fatalf("config=%#v rules=%#v", c, rules)
	}
	on, err := AgentHooksEnabled("kimi", wd)
	if err != nil || len(on) != 1 || on[0] != "bash-guard" {
		t.Fatalf("status=%v err=%v", on, err)
	}
	var command string
	for _, rule := range rules {
		v, _ := rule["command"].(string)
		if ourHook(v) == "bash-guard" {
			command = v
			if rule["event"] != "PreToolUse" || rule["matcher"] != "^Bash$" {
				t.Fatal(rule)
			}
		}
	}
	cmd := exec.Command("sh", "-c", command)
	cmd.Dir = wd
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"sleep 120"}}`)
	out, err := cmd.CombinedOutput()
	exit, ok := err.(*exec.ExitError)
	if !ok || exit.ExitCode() != 2 || !strings.Contains(string(out), "sleep 120") {
		t.Fatalf("wanted deny exit2: %v %s", err, out)
	}
	t.Logf("installed hook exit=2: %s", out)
	cmd = exec.Command("sh", "-c", command)
	cmd.Dir = wd
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"pwd"}}`)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("safe command: %v %s", err, out)
	}
	if _, err := DisableAgentHooks(o); err != nil {
		t.Fatal(err)
	}
	_, rules, err = readKimiHooks(wd)
	if err != nil || len(rules) != 1 {
		t.Fatalf("disabled rules=%v err=%v", rules, err)
	}
	if err := os.WriteFile(path, []byte("broken = ["), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := EnableAgentHooks(o); err == nil {
		t.Fatal("malformed config was overwritten")
	}
}
