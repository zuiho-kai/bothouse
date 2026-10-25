package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// Setup-wizard helpers (web wizard, `cc-connect setup`, POST /api/v1/setup/apply).

// WizardProjectOptions describes one role (= one project = one bot) written by the wizard.
// Empty fields leave the existing value alone.
type WizardProjectOptions struct {
	Name         string
	AgentType    string
	WorkDir      string
	PlatformType string         // "discord", "feishu", …
	Options      map[string]any // merged into the first platform of PlatformType (created if missing)
	GateURL      *string
	GateFallback *string
	Provider     *ProviderConfig   // inline provider, becomes the active provider
	OwnerOpenID  string            // feishu/lark: merged into allow_from (same rule as the QR save)
	AgentCmd     string            // agent option cmd (absolute CLI path found outside PATH)
	AgentArgs    []string          // agent option args (nil = leave)
	AgentOptions map[string]any    // set in the agent's options (nil = leave)
	AgentEnv     map[string]string // merged into agent option env
	DisplayName  string            // team_name: the name shown for the project ("" = leave)
}

// UpsertWizardProject creates or updates one project (see ApplyWizardProjects).
func UpsertWizardProject(o WizardProjectOptions) error {
	_, err := ApplyWizardProjects(func([]WizardProjectSnapshot) ([]WizardProjectOptions, error) {
		return []WizardProjectOptions{o}, nil
	})
	return err
}

// WizardProjectSnapshot is one [[projects]] entry as it is in config.toml now.
type WizardProjectSnapshot struct {
	Name, AgentType, WorkDir, AgentCmd string
	Platforms                          map[string]map[string]any // type → options of the first platform of that type
	GateURL, GateFallback              string
	TeamName                           string // the name shown for the project ("" = its name)
}

// WizardSnapshot reads config.toml's projects (under the config lock, released on return).
func WizardSnapshot() ([]WizardProjectSnapshot, error) {
	configMu.Lock()
	defer configMu.Unlock()
	cfg, err := loadLocked()
	if err != nil {
		return nil, err
	}
	return snapshotOf(cfg), nil
}

func snapshotOf(cfg *Config) []WizardProjectSnapshot {
	out := make([]WizardProjectSnapshot, 0, len(cfg.Projects))
	for _, p := range cfg.Projects {
		wd, _ := p.Agent.Options["work_dir"].(string)
		cmd, _ := p.Agent.Options["cmd"].(string)
		ps := WizardProjectSnapshot{Name: p.Name, AgentType: p.Agent.Type, WorkDir: wd, AgentCmd: cmd,
			Platforms: map[string]map[string]any{}, GateURL: p.GateURL, GateFallback: p.GateFallback, TeamName: p.TeamName}
		for _, pl := range p.Platforms {
			if _, seen := ps.Platforms[pl.Type]; !seen {
				ps.Platforms[pl.Type] = pl.Options
			}
		}
		out = append(out, ps)
	}
	return out
}

// ApplyWizardProjects is one read-modify-write of config.toml under configMu (in-process
// mutex + cross-process file lock): it reads the config, lets plan decide the changes
// from that fresh state, applies them and saves once (temp file + rename).
//
// The changes are made on the TOML document as a generic map, not through Config: a
// struct round trip drops every key this build does not know (another fork's or a newer
// version's settings, e.g. memory_index, session_instructions) and adds zero-valued
// sections (speech, tts, management port = 0 …). The map keeps all keys and values.
// Re-encoding still drops comments, so the previous file is copied to
// config.toml.bak-<time> first — never overwriting an earlier backup — and the path returned.
func ApplyWizardProjects(plan func([]WizardProjectSnapshot) ([]WizardProjectOptions, error)) (backup string, err error) {
	configMu.Lock()
	defer configMu.Unlock()
	if ConfigPath == "" {
		return "", fmt.Errorf("config path not set")
	}
	raw, err := os.ReadFile(ConfigPath)
	if err != nil {
		return "", fmt.Errorf("read config: %w", err)
	}
	cfg := &Config{}
	if err := toml.Unmarshal(raw, cfg); err != nil {
		return "", fmt.Errorf("parse config: %w", err)
	}
	doc := map[string]any{}
	if err := toml.Unmarshal(raw, &doc); err != nil {
		return "", fmt.Errorf("parse config: %w", err)
	}
	list, err := plan(snapshotOf(cfg))
	if err != nil {
		return "", err
	}
	for _, o := range list {
		if err := applyWizardProject(doc, o); err != nil {
			return "", err
		}
	}
	backup = backupPath(ConfigPath, time.Now())
	if err := atomicWrite(backup, raw, 0o600); err != nil {
		return "", fmt.Errorf("backup config: %w", err)
	}
	return backup, saveConfig(doc)
}

// RemoveWizardProjects takes the named projects out of config.toml (one read-modify-write
// under configMu, on the TOML document like ApplyWizardProjects so unknown keys survive). The
// setup wizard uses it to undo a role it just added that could not start: left in the file it
// would stop the next start (main exits on a project that fails to build). It returns the
// names actually removed.
func RemoveWizardProjects(names []string) ([]string, error) {
	configMu.Lock()
	defer configMu.Unlock()
	if ConfigPath == "" {
		return nil, fmt.Errorf("config path not set")
	}
	raw, err := os.ReadFile(ConfigPath)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	doc := map[string]any{}
	if err := toml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	projects, err := tableList(doc, "projects")
	if err != nil {
		return nil, err
	}
	drop := map[string]bool{}
	for _, n := range names {
		drop[n] = true
	}
	var kept []map[string]any
	var removed []string
	for _, p := range projects {
		if n, _ := p["name"].(string); drop[n] {
			removed = append(removed, n)
			continue
		}
		kept = append(kept, p)
	}
	if len(removed) == 0 {
		return nil, nil
	}
	doc["projects"] = kept
	return removed, saveConfig(doc)
}

// backupPath is config.toml.bak-20261020-121500, with -2, -3 … if that name exists.
func backupPath(configPath string, t time.Time) string {
	base := configPath + ".bak-" + t.Format("20060102-150405")
	p := base
	for n := 2; ; n++ {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			return p
		}
		p = fmt.Sprintf("%s-%d", base, n)
	}
}

// subMap returns m[key] as a table, creating it when missing.
func subMap(m map[string]any, key string) (map[string]any, error) {
	switch v := m[key].(type) {
	case map[string]any:
		return v, nil
	case nil:
		t := map[string]any{}
		m[key] = t
		return t, nil
	default:
		return nil, fmt.Errorf("config: %q is not a table", key)
	}
}

// tableList returns m[key] as an array of tables ([[key]]).
func tableList(m map[string]any, key string) ([]map[string]any, error) {
	switch v := m[key].(type) {
	case []map[string]any:
		return v, nil
	case nil:
		return nil, nil
	case []any: // empty or mixed arrays decode as []any
		out := make([]map[string]any, 0, len(v))
		for _, e := range v {
			t, ok := e.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("config: %q is not an array of tables", key)
			}
			out = append(out, t)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("config: %q is not an array of tables", key)
	}
}

// providerTable converts a ProviderConfig to the TOML table it encodes to.
func providerTable(p ProviderConfig) (map[string]any, error) {
	var buf strings.Builder
	if err := toml.NewEncoder(&buf).Encode(p); err != nil {
		return nil, err
	}
	t := map[string]any{}
	_, err := toml.Decode(buf.String(), &t)
	return t, err
}

// applyWizardProject applies one project's changes to the TOML document.
func applyWizardProject(doc map[string]any, o WizardProjectOptions) error {
	if strings.TrimSpace(o.Name) == "" {
		return fmt.Errorf("project name required")
	}
	projects, err := tableList(doc, "projects")
	if err != nil {
		return err
	}
	var p map[string]any
	for _, q := range projects {
		if q["name"] == o.Name {
			p = q
			break
		}
	}
	if p == nil {
		at := o.AgentType
		if at == "" {
			at = "claudecode"
		}
		p = map[string]any{"name": o.Name, "agent": map[string]any{"type": at, "options": map[string]any{}},
			// A new bot's reply footer leaves out the owner's subscription quota ("5h 剩 65% · 周 36%")
			// and this machine's work_dir path: the footer goes to the whole group. Both can be turned
			// back on per project. Existing projects are not touched.
			// 来源：2026-10-21 rc5 Linux 实测隐私条（开源前必须）：向导配出来的默认不把额度和本机路径发进群，已有配置不变。
			"show_quota_indicator": false, "show_workdir_indicator": false}
		projects = append(projects, p)
	}
	doc["projects"] = projects
	agent, err := subMap(p, "agent")
	if err != nil {
		return err
	}
	agentOpts, err := subMap(agent, "options")
	if err != nil {
		return err
	}
	if o.AgentType != "" {
		agent["type"] = o.AgentType
	}
	if o.WorkDir != "" {
		agentOpts["work_dir"] = o.WorkDir
	}
	if o.AgentCmd != "" {
		agentOpts["cmd"] = o.AgentCmd
	}
	if o.AgentArgs != nil {
		agentOpts["args"] = o.AgentArgs
	}
	for k, v := range o.AgentOptions {
		agentOpts[k] = v
	}
	if len(o.AgentEnv) > 0 {
		env, err := subMap(agentOpts, "env")
		if err != nil {
			return err
		}
		for k, v := range o.AgentEnv {
			env[k] = v
		}
	}
	if o.PlatformType != "" {
		plats, err := tableList(p, "platforms")
		if err != nil {
			return err
		}
		var pl map[string]any
		for _, q := range plats {
			if q["type"] == o.PlatformType {
				pl = q
				break
			}
		}
		if pl == nil {
			pl = map[string]any{"type": o.PlatformType, "options": map[string]any{}}
			plats = append(plats, pl)
		}
		p["platforms"] = plats
		opts, err := subMap(pl, "options")
		if err != nil {
			return err
		}
		for k, v := range o.Options {
			if s, ok := v.(string); ok && s == "" {
				delete(opts, k)
				continue
			}
			opts[k] = v
		}
		if o.OwnerOpenID != "" {
			cur, _ := opts["allow_from"].(string)
			if merged := mergeAllowFromValue(cur, o.OwnerOpenID); merged != "" {
				opts["allow_from"] = merged
			}
		}
	}
	if o.DisplayName != "" {
		p["team_name"] = o.DisplayName
	}
	if o.GateURL != nil {
		p["gate_url"] = *o.GateURL
	}
	if o.GateFallback != nil {
		p["gate_fallback"] = *o.GateFallback
	}
	if o.Provider != nil {
		pt, err := providerTable(*o.Provider)
		if err != nil {
			return err
		}
		existing, err := tableList(agent, "providers")
		if err != nil {
			return err
		}
		kept := make([]map[string]any, 0, len(existing)+1)
		for _, ex := range existing {
			if ex["name"] != o.Provider.Name {
				kept = append(kept, ex)
			}
		}
		agent["providers"] = append(kept, pt)
		agentOpts["provider"] = o.Provider.Name
	}
	return nil
}

// WizardPlatformProject is a project that has a platform of the asked type.
// Options include secrets (token); callers must not send them to clients.
type WizardPlatformProject struct {
	Name      string
	AgentType string
	WorkDir   string
	Options   map[string]any
	GateURL   string
	Fallback  string
}

// ListPlatformProjects returns projects that have a platform of type platType.
func ListPlatformProjects(platType string) ([]WizardPlatformProject, error) {
	configMu.Lock()
	defer configMu.Unlock()
	cfg, err := loadLocked()
	if err != nil {
		return nil, err
	}
	var out []WizardPlatformProject
	for _, p := range cfg.Projects {
		for _, pl := range p.Platforms {
			if pl.Type != platType {
				continue
			}
			wd, _ := p.Agent.Options["work_dir"].(string)
			out = append(out, WizardPlatformProject{Name: p.Name, AgentType: p.Agent.Type, WorkDir: wd,
				Options: pl.Options, GateURL: p.GateURL, Fallback: p.GateFallback})
			break
		}
	}
	return out, nil
}

// LoadForSetup parses the config without validation, for the setup wizard on a
// fresh install (no [[projects]] yet — Load/LoadPermissive reject that).
func LoadForSetup(path string) (*Config, error) {
	return load(path)
}

// EnsureManagementToken writes token into [management] (comments kept: line patch, not a rewrite).
func EnsureManagementToken(token string) error {
	configMu.Lock()
	defer configMu.Unlock()
	return patchSectionField("management", "token", quoteTomlString(token))
}

// SetManagementPort writes [management] port (comments kept): the setup wizard moved off a taken 9820.
func SetManagementPort(port int) error {
	configMu.Lock()
	defer configMu.Unlock()
	return patchSectionField("management", "port", strconv.Itoa(port))
}

// SetGatePort writes [gate] port (comments kept): the wizard or the gate supervisor moved off a port
// another install's gate holds.
func SetGatePort(port int) error {
	configMu.Lock()
	defer configMu.Unlock()
	return patchSectionField("gate", "port", strconv.Itoa(port))
}

func atomicWrite(path string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".bak-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Chmod(name, perm); err != nil {
		os.Remove(name)
		return err
	}
	return os.Rename(name, path)
}

// SetWizardMemoryIndex sets the project's memory_index (its own wiki MEMORY.md, core/memoryindex.go) when it has
// none; a value already there (set by hand or an earlier run) is kept. One locked read-modify-write on the TOML
// document, like ApplyWizardProjects, so unknown keys survive.
func SetWizardMemoryIndex(project, path string) (set bool, err error) {
	configMu.Lock()
	defer configMu.Unlock()
	if ConfigPath == "" {
		return false, fmt.Errorf("config path not set")
	}
	raw, err := os.ReadFile(ConfigPath)
	if err != nil {
		return false, fmt.Errorf("read config: %w", err)
	}
	doc := map[string]any{}
	if err := toml.Unmarshal(raw, &doc); err != nil {
		return false, fmt.Errorf("parse config: %w", err)
	}
	projects, err := tableList(doc, "projects")
	if err != nil {
		return false, err
	}
	for _, p := range projects {
		if p["name"] != project {
			continue
		}
		if v, _ := p["memory_index"].(string); strings.TrimSpace(v) != "" {
			return false, nil
		}
		p["memory_index"] = path
		doc["projects"] = projects
		return true, saveConfig(doc)
	}
	return false, fmt.Errorf("project %q not in config", project)
}

// EnsureWizardHook adds a global [[hooks]] entry of type command unless one with the same event and command is there.
func EnsureWizardHook(event, command string) (added bool, err error) {
	configMu.Lock()
	defer configMu.Unlock()
	if ConfigPath == "" {
		return false, fmt.Errorf("config path not set")
	}
	raw, err := os.ReadFile(ConfigPath)
	if err != nil {
		return false, fmt.Errorf("read config: %w", err)
	}
	doc := map[string]any{}
	if err := toml.Unmarshal(raw, &doc); err != nil {
		return false, fmt.Errorf("parse config: %w", err)
	}
	hooks, err := tableList(doc, "hooks")
	if err != nil {
		return false, err
	}
	for _, h := range hooks {
		if h["event"] == event && h["command"] == command {
			return false, nil
		}
	}
	doc["hooks"] = append(hooks, map[string]any{"event": event, "type": "command", "command": command})
	return true, saveConfig(doc)
}
