package config

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const migrateFixture = `# hand-written config, keep this comment
memory_index = "keep-unknown"

[log]
level = "info"

# claude role, never chose a mode
[[projects]]
name = "cc"
[projects.agent]
type = "claudecode"
[projects.agent.options]
work_dir = "/tmp/cc" # trailing comment
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "A"

[[projects]]
name = "cx"
[projects.agent]
type = "codex"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "B"

[[projects]]
name = "cur"
[projects.agent]
type = "cursor"
[projects.agent.options]
work_dir = "/tmp/cur"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "C"

[[projects]]
name = "dflt"
[projects.agent]
type = "claudecode"
[projects.agent.options]
mode = "default"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "D"

[[projects]]
name = "pln"
[projects.agent]
type = "claudecode"
[projects.agent.options]
mode = "plan"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "E"

[[projects]]
name = "dsh1"
[projects.agent]
type = "dsh"
[projects.agent.options]
work_dir = "/tmp/dsh"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "F"
`

func setupMigrate(t *testing.T, content string) (dataDir string) {
	t.Helper()
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	t.Cleanup(func() { ConfigPath = old })
	if err := os.WriteFile(ConfigPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "data")
}

func loadModes(t *testing.T) map[string]any {
	t.Helper()
	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]any{}
	for _, p := range cfg.Projects {
		out[p.Name] = p.Agent.Options["mode"]
	}
	return out
}

func backups(t *testing.T) []string {
	t.Helper()
	b, _ := filepath.Glob(ConfigPath + ".bak-*")
	return b
}

func TestMigrateYoloDefaults(t *testing.T) {
	dataDir := setupMigrate(t, migrateFixture)
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	applied, backup, err := MigrateYoloDefaults(dataDir, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != 3 {
		t.Fatalf("applied = %+v", applied)
	}
	// 1. missing mode -> type's full-auto mode; 2. explicit modes kept; 4. dsh untouched.
	want := map[string]any{"cc": "bypassPermissions", "cx": "yolo", "cur": "force", "dflt": "default", "pln": "plan", "dsh1": nil}
	got := loadModes(t)
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s mode = %v, want %v", k, got[k], v)
		}
	}
	// 5. comments and unknown keys kept; one backup equal to the original.
	raw, _ := os.ReadFile(ConfigPath)
	for _, keep := range []string{"# hand-written config, keep this comment", `memory_index = "keep-unknown"`, "# claude role, never chose a mode", `work_dir = "/tmp/cc" # trailing comment`} {
		if !strings.Contains(string(raw), keep) {
			t.Errorf("lost %q:\n%s", keep, raw)
		}
	}
	if b := backups(t); len(b) != 1 || b[0] != backup {
		t.Fatalf("backups = %v, returned %q", b, backup)
	}
	if b, _ := os.ReadFile(backup); string(b) != migrateFixture {
		t.Fatal("backup is not the original config")
	}
	// 6. one info line per changed role.
	if n := strings.Count(logs.String(), "set to full-auto"); n != 3 {
		t.Fatalf("log lines = %d:\n%s", n, logs.String())
	}

	// 3. runs once: a role switched back to having no mode is not touched again,
	// and a role set back to default stays default.
	if err := os.WriteFile(ConfigPath, []byte(strings.Replace(string(raw), `mode = "bypassPermissions"`, `mode = "default"`, 1)), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, _ = Load(ConfigPath)
	cfg.Projects[1].Agent.Options = nil // pretend cx lost its mode
	applied, _, err = MigrateYoloDefaults(dataDir, cfg)
	if err != nil || len(applied) != 0 {
		t.Fatalf("second run applied=%v err=%v", applied, err)
	}
	if got := loadModes(t); got["cc"] != "default" {
		t.Fatalf("cc after second run = %v", got["cc"])
	}
	if len(backups(t)) != 1 {
		t.Fatal("second run made a backup")
	}
}

func TestMigrateYoloDefaultsInlineTableSkipped(t *testing.T) {
	// A hand-written inline options table: the text patch would add a second
	// [projects.agent.options] and break the file. It must be skipped, the rest
	// written, the file must still load, and the run must not be marked done.
	content := `[[projects]]
name = "inl"
[projects.agent]
type = "codex"
options = { work_dir = "/tmp/i" }
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "A"

[[projects]]
name = "ok"
[projects.agent]
type = "codex"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "B"
`
	dataDir := setupMigrate(t, content)
	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	applied, _, err := MigrateYoloDefaults(dataDir, cfg)
	if err == nil || !strings.Contains(err.Error(), `"inl"`) {
		t.Fatalf("err = %v", err)
	}
	if len(applied) != 1 || applied[0].Project != "ok" {
		t.Fatalf("applied = %+v", applied)
	}
	got := loadModes(t) // Load must succeed
	if got["inl"] != nil || got["ok"] != "yolo" {
		t.Fatalf("modes = %v", got)
	}
	if done, _ := migrationDone(dataDir, YoloDefaultMigrationID); done {
		t.Fatal("marked done after a failed role")
	}
	// Next start: nothing writable left, so no new backup piles up.
	cfg, _ = Load(ConfigPath)
	if applied, _, err = MigrateYoloDefaults(dataDir, cfg); err == nil || len(applied) != 0 {
		t.Fatalf("retry applied=%v err=%v", applied, err)
	}
	if len(backups(t)) != 1 {
		t.Fatalf("backups = %v", backups(t))
	}
}

func TestMigrateYoloDefaultsRestoresBackupWhenWrittenFileBreaks(t *testing.T) {
	dataDir := setupMigrate(t, migrateFixture)
	testAfterAgentOptionsWrite = func() {
		_ = os.WriteFile(ConfigPath, []byte("[[projects]\nbroken"), 0o600)
	}
	t.Cleanup(func() { testAfterAgentOptionsWrite = nil })
	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	applied, _, err := MigrateYoloDefaults(dataDir, cfg)
	if err == nil || len(applied) != 0 {
		t.Fatalf("applied=%v err=%v", applied, err)
	}
	raw, _ := os.ReadFile(ConfigPath)
	if string(raw) != migrateFixture {
		t.Fatalf("config not restored:\n%s", raw)
	}
	if _, err := Load(ConfigPath); err != nil {
		t.Fatalf("restored config does not load: %v", err)
	}
	if done, _ := migrationDone(dataDir, YoloDefaultMigrationID); done {
		t.Fatal("marked done after a rollback")
	}
}

func TestRestoreConfigBackup(t *testing.T) {
	setupMigrate(t, "a = 1\n")
	bak := ConfigPath + ".bak-x"
	if err := os.WriteFile(bak, []byte("b = 2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreConfigBackup(bak); err != nil {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(ConfigPath); string(raw) != "b = 2\n" {
		t.Fatalf("got %q", raw)
	}
}
