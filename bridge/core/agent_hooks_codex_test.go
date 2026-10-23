package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentHooksCodexRoleScoped(t *testing.T) {
	useRepoHooks(t)
	wd := t.TempDir()
	data := t.TempDir()
	dir := filepath.Join(wd, ".codex")
	os.MkdirAll(dir, 0755)
	os.WriteFile(filepath.Join(dir, "config.toml"), []byte("model = \"keep-model\"\n[features]\nhooks = false\nother = true\n"), 0600)
	os.WriteFile(filepath.Join(dir, "hooks.json"), []byte(`{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"user-hook"}]}]}}`), 0600)
	opts := AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "codex"}
	got, err := EnableAgentHooks(opts)
	if err != nil {
		t.Fatal(err)
	}
	if got.SettingsFile != filepath.Join(dir, "hooks.json") || len(got.Enabled) != 2 {
		t.Fatalf("%+v", got)
	}
	if _, err := os.Stat(AgentHookSettingsPath(wd)); !os.IsNotExist(err) {
		t.Fatal("wrote Claude settings")
	}
	b, _ := os.ReadFile(filepath.Join(dir, "config.toml"))
	if !strings.Contains(string(b), "keep-model") || !strings.Contains(string(b), "hooks = true") || !strings.Contains(string(b), "other = true") {
		t.Fatal(string(b))
	}
	b, _ = os.ReadFile(got.SettingsFile)
	if !strings.Contains(string(b), "--codex") || !strings.Contains(string(b), "user-hook") {
		t.Fatal(string(b))
	}
	if _, err = EnableAgentHooks(opts); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(got.SettingsFile)
	if strings.Count(string(b), "--codex") != 2 {
		t.Fatal("not idempotent", string(b))
	}
	off, err := DisableAgentHooks(opts)
	if err != nil || len(off.Enabled) != 0 {
		t.Fatalf("%+v %v", off, err)
	}
	b, _ = os.ReadFile(got.SettingsFile)
	if !strings.Contains(string(b), "user-hook") || strings.Contains(string(b), "--codex") {
		t.Fatal(string(b))
	}
	if !wizardHooksFor("codex") {
		t.Fatal("wizard excludes codex")
	}
}

func TestAgentHooksCodexRejectsUnadaptedHooks(t *testing.T) {
	_, err := (AgentHookOptions{CLI: "codex", Only: []string{"dispatch-review-guard"}}).names()
	if err == nil {
		t.Fatal("unadapted hook accepted")
	}
}
