package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const moduleTestConfig = `[[projects]]
name = "a"
memory_index = "/tmp/a/MEMORY.md"
[projects.agent]
type = "claudecode"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "t1"
[[projects.platforms]]
type = "qq"
[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"

[[projects]]
name = "b"
[projects.agent]
type = "codex"
[[projects.platforms]]
type = "lark"
[projects.platforms.options]
app_id = "x"
`

func TestSetModuleDisabled(t *testing.T) {
	old := ConfigPath
	defer func() { ConfigPath = old }()
	dir := t.TempDir()
	ConfigPath = filepath.Join(dir, "config.toml")
	if err := os.WriteFile(ConfigPath, []byte(moduleTestConfig), 0o600); err != nil {
		t.Fatal(err)
	}

	changed, backup, err := SetModuleDisabled("qq", true)
	if err != nil || !reflect.DeepEqual(changed, []string{"a"}) || backup == "" {
		t.Fatalf("disable qq = %v, %q, %v", changed, backup, err)
	}
	if b, _ := os.ReadFile(backup); string(b) != moduleTestConfig {
		t.Fatal("backup is not the previous file")
	}
	raw, _ := os.ReadFile(ConfigPath)
	if !strings.Contains(string(raw), "memory_index") || !strings.Contains(string(raw), `ws_url = "ws://127.0.0.1:3001"`) {
		t.Fatalf("disable dropped keys or options:\n%s", raw)
	}
	cfg, err := LoadForSetup(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.Projects[0].ActivePlatforms(); len(got) != 1 || got[0].Type != "discord" {
		t.Fatalf("active platforms of a = %+v, want discord only", got)
	}
	st := ModuleStates(cfg)
	if !reflect.DeepEqual(st["qq"], ModuleState{Disabled: []string{"a"}}) ||
		!reflect.DeepEqual(st["feishu"], ModuleState{Enabled: []string{"b"}}) {
		t.Fatalf("states = %+v", st)
	}
	if _, ok := st["cloud_web"]; ok {
		t.Fatal("an unconfigured module is listed")
	}

	// same state again: nothing written, no backup
	if changed, backup, err := SetModuleDisabled("qq", true); err != nil || changed != nil || backup != "" {
		t.Fatalf("second disable = %v, %q, %v", changed, backup, err)
	}

	if changed, _, err := SetModuleDisabled("qq", false); err != nil || !reflect.DeepEqual(changed, []string{"a"}) {
		t.Fatalf("enable qq = %v, %v", changed, err)
	}
	raw, _ = os.ReadFile(ConfigPath)
	if strings.Contains(string(raw), "disabled") {
		t.Fatalf("enable left the mark:\n%s", raw)
	}
	if _, _, err := SetModuleDisabled("telegram", true); err == nil {
		t.Fatal("unknown module accepted")
	}
}
