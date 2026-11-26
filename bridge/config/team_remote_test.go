package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTeamRemoteSettingsPersistAndApplyOnlyToSelectedRoles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte(`
[[projects]]
name = "ducc"
[projects.agent]
type = "claudecode"
[projects.agent.options]
work_dir = "/old/path"
remote_host = "old-host"
relay_host = "old-relay"
model = "old-model"

[[projects]]
name = "other"
[projects.agent]
type = "zulu"

[[projects]]
name = "codex"
[projects.agent]
type = "codex"
`), 0600); err != nil {
		t.Fatal(err)
	}
	oldPath := ConfigPath
	ConfigPath = path
	t.Cleanup(func() { ConfigPath = oldPath })

	settings := TeamRemoteConfig{
		Enabled: true, RemoteHost: "njjs", RelayHost: "relay", WorkDir: "/linux/repo",
		SSHArgs: []string{"-o", "ConnectTimeout=5"}, Projects: []string{"ducc", "codex"},
	}
	if err := SaveGlobalSettings(GlobalSettingsUpdate{TeamRemote: &settings}); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadPermissive(path)
	if err != nil {
		t.Fatal(err)
	}
	applied := cfg.TeamRemote.Apply(cfg.Projects[0]).Agent.Options
	if applied["remote_host"] != "njjs" || applied["relay_host"] != "relay" ||
		applied["work_dir"] != "/linux/repo" || applied["model"] != "old-model" {
		t.Fatalf("effective SSH options: %v", applied)
	}
	if args, ok := applied["ssh_args"].([]string); !ok || len(args) != 2 || args[1] != "ConnectTimeout=5" {
		t.Fatalf("effective SSH args: %v", applied["ssh_args"])
	}
	for _, p := range cfg.Projects[1:] {
		if got := cfg.TeamRemote.Apply(p).Agent.Options["remote_host"]; got != nil {
			t.Fatalf("%s unexpectedly uses %v", p.Name, got)
		}
	}
	settings.Enabled = false
	if err := SaveGlobalSettings(GlobalSettingsUpdate{TeamRemote: &settings}); err != nil {
		t.Fatal(err)
	}
	cfg, err = LoadPermissive(path)
	if err != nil {
		t.Fatal(err)
	}
	restored := cfg.TeamRemote.Apply(cfg.Projects[0]).Agent.Options
	if restored["remote_host"] != "old-host" || restored["work_dir"] != "/old/path" || restored["relay_host"] != "old-relay" {
		t.Fatalf("original SSH options: %v", restored)
	}
}
