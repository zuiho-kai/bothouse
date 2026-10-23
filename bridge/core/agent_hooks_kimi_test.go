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
			if rule["event"] != "PreToolUse" || rule["matcher"] != "Bash|bash" {
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

func TestKimiReviewPreservesConfigAndActivation(t *testing.T) {
	useRepoHooks(t)
	wd, data := t.TempDir(), t.TempDir()
	path := KimiHookConfigPath(wd)
	original := "# user model comment\ndefault_model = \"demo\" # keep inline\n\n[[hooks]] # user hook\nevent = \"Stop\"\ncommand = \"user-hook\"\n# trailing user comment\n"
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	if got := KimiHookHomeIfPresent(wd); got != "" {
		t.Fatalf("inactive role changes home: %s", got)
	}
	o := AgentHookOptions{CLI: "kimi", WorkDir: wd, DataDir: data, Lang: "en"}
	res, err := EnableAgentHooks(o)
	if err != nil {
		t.Fatal(err)
	}
	if KimiHookHomeIfPresent(wd) == "" {
		t.Fatal("active hook has no home")
	}
	b, _ := os.ReadFile(path)
	if !strings.HasPrefix(string(b), original) {
		t.Fatalf("user config rewritten: %s", b)
	}
	persona, _ := os.ReadFile(res.PersonaFile)
	if !strings.Contains(string(persona), "Configure a model") {
		t.Fatalf("Kimi scope missing from persona: %s", persona)
	}
	if err := os.MkdirAll(filepath.Dir(AgentHookSwitchFile(wd)), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(AgentHookSwitchFile(wd), []byte(`{"off":["bash-guard"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if KimiHookHomeIfPresent(wd) != "" {
		t.Fatal("paused hook changes home")
	}
	if _, err := DisableAgentHooks(o); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(path)
	if string(b) != original {
		t.Fatalf("disable changed user bytes: %q", b)
	}
	if KimiHookHomeIfPresent(wd) != "" {
		t.Fatal("disabled hook changes home")
	}
	if _, err := os.Stat(filepath.Join(wd, ".claude")); !os.IsNotExist(err) {
		t.Fatalf("created .claude: %v", err)
	}
}

func TestHookSwitchMigration(t *testing.T) {
	wd := t.TempDir()
	legacy := filepath.Join(wd, ".claude", "conest-hooks.json")
	if err := os.MkdirAll(filepath.Dir(legacy), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte(`{"off":["bash-guard"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if got := AgentHooksSwitchedOff(wd); len(got) != 1 || got[0] != "bash-guard" {
		t.Fatal(got)
	}
	if AgentHookSwitchFile(wd) != filepath.Join(wd, ".bothouse", "conest-hooks.json") {
		t.Fatal("switch path not generic")
	}
}

func TestKimiTextRoundTrip(t *testing.T) {
	command := agentHookCommand("/usr/bin/python3", "/tmp/hooks", "bash-guard", "--kimi")
	for _, original := range []string{"", "# comment", "default_model = \"demo\"\n[providers.demo]\nbase_url = \"https://example.test\"\n", "message = \"\"\"\n[[hooks]]\n\"\"\"\n"} {
		on, err := rewriteKimiHookText([]byte(original), true, command)
		if err != nil {
			t.Fatal(err)
		}
		twice, err := rewriteKimiHookText(on, true, command)
		if err != nil || string(twice) != string(on) {
			t.Fatalf("not idempotent: %v\n%s", err, twice)
		}
		// A user table appended later must survive removal of the managed entry.
		tail := "\n[extra] # user\nvalue = 1\n"
		off, err := rewriteKimiHookText(append(on, []byte(tail)...), false, command)
		if err != nil || string(off) != original+tail {
			t.Fatalf("roundtrip: %v got %q", err, off)
		}
	}
}
