package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/BurntSushi/toml"
)

func TestUpsertWizardProject(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	if err := os.WriteFile(ConfigPath, []byte("[log]\nlevel = \"info\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	gate, fb := "http://127.0.0.1:9930/decide?bot=whale", "context"
	err := UpsertWizardProject(WizardProjectOptions{Name: "whale", AgentType: "codex", WorkDir: "/tmp/w", PlatformType: "discord",
		Options: map[string]any{"token": "T", "guild_id": "900"}, GateURL: &gate, GateFallback: &fb,
		Provider: &ProviderConfig{Name: "wizard-local", BaseURL: "http://127.0.0.1:11434/v1", APIFormat: "openai_chat"}})
	if err != nil {
		t.Fatal(err)
	}
	// second write merges options, keeps token, replaces provider with the same name
	if err := UpsertWizardProject(WizardProjectOptions{Name: "whale", PlatformType: "discord",
		Options:  map[string]any{"allow_bots": "111", "guild_id": ""},
		Provider: &ProviderConfig{Name: "wizard-local", BaseURL: "http://127.0.0.1:1234/v1", APIFormat: "openai_chat"}}); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadPermissive(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	p := cfg.Projects[0]
	opts := p.Platforms[0].Options
	if len(cfg.Projects) != 1 || p.Agent.Type != "codex" || p.GateURL != gate || p.GateFallback != "context" ||
		opts["token"] != "T" || opts["allow_bots"] != "111" || opts["guild_id"] != nil {
		t.Fatalf("project = %+v opts=%v", p, opts)
	}
	if len(p.Agent.Providers) != 1 || p.Agent.Providers[0].BaseURL != "http://127.0.0.1:1234/v1" || p.Agent.Options["provider"] != "wizard-local" {
		t.Fatalf("providers = %+v", p.Agent.Providers)
	}
	raw, _ := os.ReadFile(ConfigPath)
	if !strings.Contains(string(raw), `api_format = "openai_chat"`) {
		t.Fatalf("api_format not persisted:\n%s", raw)
	}
	bots, err := ListPlatformProjects("discord")
	if err != nil || len(bots) != 1 || bots[0].Options["token"] != "T" || bots[0].WorkDir != "/tmp/w" {
		t.Fatalf("list = %+v %v", bots, err)
	}
}

func TestApplyWizardProjectsBatchBackupAndAtomic(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	orig := "# my comment\n[log]\nlevel = \"info\"\n"
	if err := os.WriteFile(ConfigPath, []byte(orig), 0o600); err != nil {
		t.Fatal(err)
	}
	backup, err := ApplyWizardProjects(func([]WizardProjectSnapshot) ([]WizardProjectOptions, error) {
		return []WizardProjectOptions{
			{Name: "a", AgentType: "claudecode", PlatformType: "discord", Options: map[string]any{"token": "A"}},
			{Name: "b", AgentType: "codex", PlatformType: "feishu", Options: map[string]any{"app_id": "cli", "app_secret": "s"}, OwnerOpenID: "ou_1"},
		}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(backup); string(b) != orig || !strings.HasPrefix(backup, ConfigPath+".bak-") {
		t.Fatalf("backup %s = %q", backup, b)
	}
	cfg, err := LoadPermissive(ConfigPath)
	if err != nil || len(cfg.Projects) != 2 || cfg.Projects[1].Platforms[0].Options["allow_from"] != "ou_1" {
		t.Fatalf("cfg = %+v err=%v", cfg, err)
	}
	// a failing item leaves config.toml exactly as it was
	before, _ := os.ReadFile(ConfigPath)
	if _, err := ApplyWizardProjects(func([]WizardProjectSnapshot) ([]WizardProjectOptions, error) {
		return []WizardProjectOptions{{Name: "c", AgentType: "gemini"}, {Name: ""}}, nil
	}); err == nil {
		t.Fatal("want error for empty name")
	}
	after, _ := os.ReadFile(ConfigPath)
	if string(before) != string(after) {
		t.Fatal("config changed although the batch failed")
	}
	if entries, _ := filepath.Glob(filepath.Join(dir, ".config-*.tmp")); len(entries) != 0 {
		t.Fatalf("temp files left: %v", entries)
	}
}

func TestEnsureManagementTokenKeepsComments(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	_ = os.WriteFile(ConfigPath, []byte("# keep me\n[management]\nenabled = true\nport = 9820\n"), 0o600)
	if err := EnsureManagementToken("tok123"); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(ConfigPath)
	cfg, err := LoadForSetup(ConfigPath)
	if err != nil || cfg.Management.Token != "tok123" || !strings.Contains(string(raw), "# keep me") {
		t.Fatalf("token=%q err=%v\n%s", cfg.Management.Token, err, raw)
	}
}

// M5: backups never overwrite each other; plan sees the config as it is under the lock.
func TestApplyWizardProjectsBackupsAndFreshPlan(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	_ = os.WriteFile(ConfigPath, []byte("[log]\nlevel = \"info\"\n"), 0o600)
	var seen []string
	add := func(name string) string {
		b, err := ApplyWizardProjects(func(ps []WizardProjectSnapshot) ([]WizardProjectOptions, error) {
			seen = seen[:0]
			for _, p := range ps {
				seen = append(seen, p.Name)
			}
			return []WizardProjectOptions{{Name: name, AgentType: "codex", AgentCmd: "/opt/x/codex", PlatformType: "discord",
				Options: map[string]any{"token": name}}}, nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	b1, b2 := add("a"), add("b")
	if b1 == b2 {
		t.Fatalf("second backup overwrote the first: %s", b1)
	}
	if len(seen) != 1 || seen[0] != "a" {
		t.Fatalf("plan saw %v, want [a]", seen)
	}
	cfg, _ := LoadForSetup(ConfigPath)
	if cfg.Projects[1].Agent.Options["cmd"] != "/opt/x/codex" {
		t.Fatalf("cmd not written: %v", cfg.Projects[1].Agent.Options)
	}
}

// M5: the cross-process lock covers every config writer; a second holder waits.
func TestConfigLockIsCrossProcessFile(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	rel, err := lockConfigFile(ConfigPath) // another "process" holds the file lock
	if err != nil {
		t.Fatal(err)
	}
	got := make(chan struct{})
	go func() {
		configMu.Lock() // what every config writer does
		configMu.Unlock()
		close(got)
	}()
	select {
	case <-got:
		t.Fatal("configMu did not wait for the file lock")
	case <-time.After(200 * time.Millisecond):
	}
	rel()
	select {
	case <-got:
	case <-time.After(2 * time.Second):
		t.Fatal("configMu never got the lock")
	}
}

// The wizard edits the TOML document, not the Config struct: keys this build does not
// know (another fork's settings) survive, the ${ENV} token stays, no zero-valued sections appear.
func TestApplyWizardProjectsKeepsUnknownKeys(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	orig := `language = "zh"
[[projects]]
name = "lb"
memory_index = "~/wiki/MEMORY.md"
gate_url = "http://127.0.0.1:9930/decide?bot=lb"
[projects.image_fresh]
enabled = true
max_mb = 2
[projects.session_instructions]
"discord:1" = "/x/PLAY.md"
[projects.agent]
type = "codex"
[projects.agent.options]
work_dir = "/w"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "${TOK}"
aux_channels = { "1" = "2" }
`
	if err := os.WriteFile(ConfigPath, []byte(orig), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := UpsertWizardProject(WizardProjectOptions{Name: "lb", AgentType: "codex", PlatformType: "discord",
		Options: map[string]any{"allow_bots": "9"}}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(ConfigPath)
	got := map[string]any{}
	if _, err := toml.Decode(string(raw), &got); err != nil {
		t.Fatal(err)
	}
	p := got["projects"].([]map[string]any)[0]
	opts := p["platforms"].([]map[string]any)[0]["options"].(map[string]any)
	if p["memory_index"] != "~/wiki/MEMORY.md" || p["image_fresh"] == nil || p["session_instructions"] == nil ||
		opts["token"] != "${TOK}" || opts["aux_channels"] == nil || opts["allow_bots"] != "9" {
		t.Fatalf("keys lost or token rewritten:\n%s", raw)
	}
	for _, k := range []string{"speech", "tts", "management", "webhook", "bridge", "attachment_send"} {
		if _, ok := got[k]; ok {
			t.Errorf("zero-valued %q added:\n%s", k, raw)
		}
	}
}

func TestUpsertWizardProjectAgentArgsEnv(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	if err := os.WriteFile(ConfigPath, []byte("[log]\nlevel = \"info\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := UpsertWizardProject(WizardProjectOptions{Name: "whale", AgentType: "dsh", AgentCmd: "/n/node",
		AgentArgs: []string{"/d/bin.js", "--profile", "acp"}, AgentEnv: map[string]string{"UV_CACHE_DIR": "/w/.cache/uv"}}); err != nil {
		t.Fatal(err)
	}
	// a later write merges env and leaves args alone when it has none
	if err := UpsertWizardProject(WizardProjectOptions{Name: "whale", AgentEnv: map[string]string{"K": "v"}}); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadPermissive(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	o := cfg.Projects[0].Agent.Options
	args, _ := o["args"].([]any)
	env, _ := o["env"].(map[string]any)
	if cfg.Projects[0].Agent.Type != "dsh" || o["cmd"] != "/n/node" || len(args) != 3 || args[0] != "/d/bin.js" ||
		env["UV_CACHE_DIR"] != "/w/.cache/uv" || env["K"] != "v" {
		t.Fatalf("agent options = %v", o)
	}
}

// A role whose project name had to be role-N keeps the user's name as team_name, which the
// running project and the wizard snapshot both read back.
func TestUpsertWizardProjectDisplayName(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	if err := os.WriteFile(ConfigPath, []byte("[log]\nlevel = \"info\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := UpsertWizardProject(WizardProjectOptions{Name: "role-1", AgentType: "dsh", PlatformType: "cloud_web",
		Options: map[string]any{"ws_url": "ws://x"}, DisplayName: "鲸鱼娘"}); err != nil {
		t.Fatal(err)
	}
	// a later write without a display name leaves it alone
	if err := UpsertWizardProject(WizardProjectOptions{Name: "role-1", PlatformType: "cloud_web", Options: map[string]any{"ws_url": "ws://y"}}); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadPermissive(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if p := cfg.Projects[0]; p.TeamName != "鲸鱼娘" || p.Agent.Type != "dsh" {
		t.Fatalf("project = %+v", p)
	}
	snap, err := WizardSnapshot()
	if err != nil || len(snap) != 1 || snap[0].TeamName != "鲸鱼娘" {
		t.Fatalf("snapshot = %+v %v", snap, err)
	}
}

// A role the wizard added that did not start is taken out again; the other projects and keys this
// build does not know stay.
func TestRemoveWizardProjects(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	src := `memory_index = "keep-me"

[[projects]]
name = "old-role"
[projects.agent]
type = "claudecode"

[[projects]]
name = "delta"
[projects.agent]
type = "no-such-agent"

[[projects]]
name = "eta"
[projects.agent]
type = "codex"
`
	if err := os.WriteFile(ConfigPath, []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	removed, err := RemoveWizardProjects([]string{"delta", "missing"})
	if err != nil || len(removed) != 1 || removed[0] != "delta" {
		t.Fatalf("removed = %v, err = %v", removed, err)
	}
	b, _ := os.ReadFile(ConfigPath)
	got := string(b)
	if strings.Contains(got, "delta") || !strings.Contains(got, "old-role") || !strings.Contains(got, "eta") || !strings.Contains(got, "keep-me") {
		t.Fatalf("config after removal:\n%s", got)
	}
}

func TestSetWizardMemoryIndex(t *testing.T) {
	dir := t.TempDir()
	old := ConfigPath
	ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { ConfigPath = old }()
	orig := `[[projects]]
name = "a"
gate_url = "http://x"
[projects.agent]
type = "codex"
[[projects.platforms]]
type = "discord"
[[projects]]
name = "b"
memory_index = "~/wiki/MEMORY.md"
[projects.agent]
type = "claudecode"
[[projects.platforms]]
type = "discord"
`
	if err := os.WriteFile(ConfigPath, []byte(orig), 0o600); err != nil {
		t.Fatal(err)
	}
	win := `C:\Users\me\roles\a\wiki\MEMORY.md`
	if set, err := SetWizardMemoryIndex("a", win); err != nil || !set {
		t.Fatalf("a: %v %v", set, err)
	}
	if set, err := SetWizardMemoryIndex("b", "/other/MEMORY.md"); err != nil || set {
		t.Fatalf("b overwritten: %v %v", set, err)
	}
	if _, err := SetWizardMemoryIndex("c", "/x"); err == nil {
		t.Fatal("missing project: no error")
	}
	cfg, err := Load(ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Projects[0].MemoryIndex != win || cfg.Projects[0].GateURL != "http://x" || cfg.Projects[1].MemoryIndex != "~/wiki/MEMORY.md" {
		t.Fatalf("projects = %+v", cfg.Projects)
	}
}
