package config

import (
	"bytes"
	"log/slog"
	"os"
	"os/exec"
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
	// [projects.agent.options] and break the file. It is skipped for good, the
	// rest written, the file must still load, and the run is marked done.
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
	assertSkippedRole(t, content, "inl")
}

func TestMigrateYoloDefaultsDottedOptionsSkipped(t *testing.T) {
	// options.work_dir under [projects.agent]: adding [projects.agent.options]
	// would define the table twice (tomllib rejects that), so the role is skipped.
	content := `[[projects]]
name = "dot"
[projects.agent]
type = "codex"
options.work_dir = "/tmp/d"
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
	assertSkippedRole(t, content, "dot")
	raw, _ := os.ReadFile(ConfigPath)
	if n := strings.Count(string(raw), "[projects.agent.options]"); n != 1 {
		t.Fatalf("[projects.agent.options] headers = %d, want 1 (only for \"ok\"):\n%s", n, raw)
	}
	assertTomllibLoads(t, ConfigPath)
}

func assertSkippedRole(t *testing.T, content, skipped string) {
	t.Helper()
	dataDir := setupMigrate(t, content)
	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	applied, _, err := MigrateYoloDefaults(dataDir, cfg)
	if err == nil || !strings.Contains(err.Error(), `"`+skipped+`"`) {
		t.Fatalf("err = %v", err)
	}
	if len(applied) != 1 || applied[0].Project != "ok" {
		t.Fatalf("applied = %+v", applied)
	}
	got := loadModes(t) // Load must succeed
	if got[skipped] != nil || got["ok"] != "yolo" {
		t.Fatalf("modes = %v", got)
	}
	if done, _ := migrationDone(dataDir, YoloDefaultMigrationID); !done {
		t.Fatal("not marked done: a structural skip is permanent")
	}
	cfg, _ = Load(ConfigPath)
	if applied, _, err = MigrateYoloDefaults(dataDir, cfg); err != nil || len(applied) != 0 {
		t.Fatalf("second run applied=%v err=%v", applied, err)
	}
	if len(backups(t)) != 1 {
		t.Fatalf("backups = %v", backups(t))
	}
}

// assertTomllibLoads parses path with Python's tomllib (what companion uses)
// when python3 >= 3.11 is available.
func assertTomllibLoads(t *testing.T, path string) {
	t.Helper()
	if err := exec.Command("python3", "-c", "import tomllib").Run(); err != nil {
		t.Log("python3 with tomllib (>=3.11) not available; relying on the header count check")
		return
	}
	out, err := exec.Command("python3", "-c", `import tomllib,sys;tomllib.load(open(sys.argv[1],"rb"))`, path).CombinedOutput()
	if err != nil {
		t.Fatalf("tomllib rejects migrated config: %v\n%s", err, out)
	}
}

func TestMigrateYoloDefaultsSymlinkSkipped(t *testing.T) {
	content := "[[projects]]\nname = \"ok\"\n[projects.agent]\ntype = \"codex\"\n[[projects.platforms]]\ntype = \"discord\"\n[projects.platforms.options]\ntoken = \"B\"\n"
	dataDir := setupMigrate(t, content)
	real := ConfigPath + ".real"
	if err := os.Rename(ConfigPath, real); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, ConfigPath); err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	applied, backup, err := MigrateYoloDefaults(dataDir, cfg)
	if err != nil || len(applied) != 0 || backup != "" {
		t.Fatalf("applied=%v backup=%q err=%v", applied, backup, err)
	}
	if b, _ := os.ReadFile(real); string(b) != content {
		t.Fatal("symlink target changed")
	}
	if fi, _ := os.Lstat(ConfigPath); fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("symlink replaced")
	}
	if !strings.Contains(logs.String(), "level=WARN") || !strings.Contains(logs.String(), "symlink") {
		t.Fatalf("no warn:\n%s", logs.String())
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

// The dotted-options skip is migration-only: SaveAgentModel (used by /model
// before switching) must still succeed on such configs, as before.
func TestSaveAgentModelDottedOptionsStillWorks(t *testing.T) {
	content := `[[projects]]
name = "dot"
[projects.agent]
type = "codex"
options.work_dir = "/tmp/d"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "A"
`
	setupMigrate(t, content)
	if err := SaveAgentModel("dot", "gpt-5.4"); err != nil {
		t.Fatalf("SaveAgentModel() on dotted options: %v", err)
	}
	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := cfg.Projects[0].Agent.Options["model"].(string); got != "gpt-5.4" {
		t.Fatalf("agent.options.model = %q, want gpt-5.4", got)
	}
}

const hintFixture = `[[projects]]
name = "cursor-acp"
[projects.agent]
type = "acp"
[projects.agent.options]
work_dir = "/tmp/c"
cmd = "agent"
args = ["acp"]
auth_method = "cursor_login"
display_name = "Cursor"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "A"

[[projects]]
name = "dsh1"
[projects.agent]
type = "dsh"
[projects.agent.options]
work_dir = "/tmp/dsh"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "B"

[[projects]]
name = "acp-moded"
[projects.agent]
type = "acp"
[projects.agent.options]
cmd = "agent"
args = ["acp"]
mode = "plan"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "C"

[[projects]]
name = "cc"
[projects.agent]
type = "claudecode"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "D"
`

func TestHintRolesWithoutKnownMode(t *testing.T) {
	dataDir := setupMigrate(t, hintFixture)
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	// An old data dir: the full-auto migration already ran before acp/dsh had a hint.
	if err := markMigrationDone(dataDir, YoloDefaultMigrationID); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if applied, _, err := MigrateYoloDefaults(dataDir, cfg); err != nil || len(applied) != 0 {
		t.Fatalf("yolo migration re-ran: %v %v", applied, err)
	}
	hinted, err := HintRolesWithoutKnownMode(dataDir, cfg)
	if err != nil {
		t.Fatal(err)
	}
	// Cursor-acp and dsh without mode are hinted; a role with a mode and a known type are not.
	if strings.Join(hinted, ",") != "cursor-acp,dsh1" {
		t.Fatalf("hinted = %v", hinted)
	}
	out := logs.String()
	if n := strings.Count(out, "permission mode not set automatically"); n != 2 {
		t.Fatalf("hint lines = %d:\n%s", n, out)
	}
	if n := strings.Count(out, "agent/plan/ask"); n != 1 {
		t.Fatalf("cursor note lines = %d:\n%s", n, out)
	}
	// Config is not written: no mode, no backup.
	got := loadModes(t)
	if got["cursor-acp"] != nil || got["dsh1"] != nil || got["acp-moded"] != "plan" || got["cc"] != nil {
		t.Fatalf("modes changed: %v", got)
	}
	if raw, _ := os.ReadFile(ConfigPath); string(raw) != hintFixture || len(backups(t)) != 0 {
		t.Fatal("hint changed config.toml")
	}
	// Once only.
	logs.Reset()
	hinted, err = HintRolesWithoutKnownMode(dataDir, cfg)
	if err != nil || len(hinted) != 0 || strings.Contains(logs.String(), "not set automatically") {
		t.Fatalf("second run hinted=%v err=%v logs=%s", hinted, err, logs.String())
	}
}

func TestIsCursorACP(t *testing.T) {
	for _, c := range []struct {
		opts map[string]any
		want bool
	}{
		{map[string]any{"cmd": "agent", "args": []any{"acp"}}, true},
		{map[string]any{"command": "/Users/x/.local/bin/cursor-agent", "args": []string{"acp"}}, true},
		{map[string]any{"cmd": "agent acp"}, true},
		{map[string]any{"cmd": "agent"}, false},
		{map[string]any{"cmd": "devin", "args": []any{"acp"}}, false},
		{map[string]any{}, false},
	} {
		if got := isCursorACP(c.opts); got != c.want {
			t.Errorf("isCursorACP(%v) = %v, want %v", c.opts, got, c.want)
		}
	}
}
