package config

import (
	"github.com/chenhg5/cc-connect/core"
	"os"
	"path/filepath"
	"testing"
)

func TestRoleIdentitySwitchPreservesCustomNameAndPersona(t *testing.T) {
	for _, tc := range []struct {
		name       string
		customized *bool
		want       string
	}{
		{"automatic", boolValue(false), "Claude Code-2"},
		{"custom", boolValue(true), "小码"},
		{"legacy", nil, "小码"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			old := ConfigPath
			ConfigPath = filepath.Join(dir, "config.toml")
			t.Cleanup(func() { ConfigPath = old })
			if err := os.WriteFile(ConfigPath, []byte("[log]\nlevel='info'\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			work := filepath.Join(dir, "work")
			if err := os.MkdirAll(work, 0o755); err != nil {
				t.Fatal(err)
			}
			persona := "# Custom instructions\nKeep this speaking style and responsibility.\n"
			if err := os.WriteFile(core.PersonaFilePath("codex", work), []byte(persona), 0o600); err != nil {
				t.Fatal(err)
			}
			initial := "小码"
			if tc.customized != nil && !*tc.customized {
				initial = "Codex"
			}
			if err := UpsertWizardProject(WizardProjectOptions{Name: "coder", AgentType: "codex", WorkDir: work, DisplayName: initial, NameCustomized: tc.customized, PlatformType: "cloud_web", Options: map[string]any{"ws_url": "ws://localhost/cloud-web/ws?name=Codex"}}); err != nil {
				t.Fatal(err)
			}
			if err := UpsertWizardProject(WizardProjectOptions{Name: "taken", AgentType: "claudecode", DisplayName: "Claude Code"}); err != nil {
				t.Fatal(err)
			}
			backend := "claudecode"
			if err := SaveProjectSettings("coder", ProjectSettingsUpdate{AgentType: &backend}); err != nil {
				t.Fatal(err)
			}
			cfg, err := LoadPermissive(ConfigPath)
			if err != nil {
				t.Fatal(err)
			}
			got := cfg.Projects[0]
			if got.TeamName != tc.want || got.Agent.Type != backend {
				t.Fatalf("name=%s backend=%s", got.TeamName, got.Agent.Type)
			}
			b, err := os.ReadFile(core.PersonaFilePath("claudecode", work))
			if tc.customized == nil {
				if !os.IsNotExist(err) {
					t.Fatal("legacy persona migrated")
				}
			} else if err != nil || string(b) != persona {
				t.Fatalf("persona=%q err=%v", b, err)
			}
			details := GetProjectConfigDetails("coder")
			if tc.customized == nil {
				if _, ok := details["name_customized"]; ok {
					t.Fatal("legacy metadata introduced")
				}
			} else if details["name_customized"] != *tc.customized {
				t.Fatal(details)
			}
		})
	}
}
func boolValue(v bool) *bool { return &v }
