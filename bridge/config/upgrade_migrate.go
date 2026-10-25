package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/BurntSushi/toml"

	"github.com/chenhg5/cc-connect/core"
)

// YoloDefaultMigrationID marks, in <data_dir>/migrations.json, that roles set up
// before new roles defaulted to full-auto (#225) have been given a mode once.
const YoloDefaultMigrationID = "yolo-default-2026-10"

// ModeHintMigrationID marks that roles whose type has no known full-auto mode
// (dsh, acp, …) and no mode of their own were told about, once, in the log. It
// is separate from YoloDefaultMigrationID so data dirs that already ran that
// migration still get the hint.
const ModeHintMigrationID = "mode-hint-unknown-type-2026-10"

const migrationsFile = "migrations.json"

// testAfterAgentOptionsWrite lets tests damage the file between write and re-check.
var testAfterAgentOptionsWrite func()

// AgentOptionEdit sets one string key under [projects.agent.options].
type AgentOptionEdit struct {
	Project string
	Key     string
	Value   string
}

// SetAgentOptionsIfAbsent writes each edit whose key is not already in the
// project's agent options, keeping comments and unknown keys (text patch, not a
// rewrite). Every patch is checked by re-parsing: it must add exactly that key
// and change nothing else, or it is dropped and reported in err. The file is
// backed up once (config.toml.bak-<time>) before the write; after the write the
// file is parsed and validated again, and on any mismatch the backup is put back.
// applied lists the edits that are in the file when it returns.
func SetAgentOptionsIfAbsent(edits []AgentOptionEdit) (applied []AgentOptionEdit, backup string, err error) {
	configMu.Lock()
	defer configMu.Unlock()
	if ConfigPath == "" {
		return nil, "", fmt.Errorf("config path not set")
	}
	info, err := os.Stat(ConfigPath)
	if err != nil {
		return nil, "", fmt.Errorf("stat config: %w", err)
	}
	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return nil, "", fmt.Errorf("read config: %w", err)
	}
	raw := string(data)
	cfg := &Config{}
	if err := toml.Unmarshal(data, cfg); err != nil {
		return nil, "", fmt.Errorf("parse config: %w", err)
	}
	if _, err := parseTomlDoc(raw); err != nil {
		return nil, "", err
	}

	var failures []error
	cur := raw
	for _, e := range edits {
		idx := projectIndex(cfg, e.Project)
		if idx < 0 {
			failures = append(failures, roleSkipped(fmt.Errorf("project %q not found", e.Project)))
			continue
		}
		if _, ok := cfg.Projects[idx].Agent.Options[e.Key]; ok {
			continue
		}
		if hasNonStandardOptionsTable(cur, idx, cfg.Projects[idx].Agent.Options != nil) {
			failures = append(failures, roleSkipped(fmt.Errorf("project %q: %w", e.Project, ErrNonStandardOptionsTable)))
			continue
		}
		cand, perr := patchProjectAgentOptionText(cur, e.Project, e.Key, e.Value)
		if perr != nil {
			failures = append(failures, roleSkipped(fmt.Errorf("project %q: %w", e.Project, perr)))
			continue
		}
		candDoc, perr := parseTomlDoc(cand)
		if perr != nil {
			failures = append(failures, roleSkipped(fmt.Errorf("project %q: patch gives invalid TOML, skipped: %w", e.Project, perr)))
			continue
		}
		want, _ := parseTomlDoc(cur)
		if !setDocAgentOption(want, idx, e.Key, e.Value) || !reflect.DeepEqual(want, candDoc) {
			failures = append(failures, roleSkipped(fmt.Errorf("project %q: patch would change more than options.%s, skipped", e.Project, e.Key)))
			continue
		}
		cur = cand
		applied = append(applied, e)
	}
	if len(applied) == 0 {
		return nil, "", errors.Join(failures...)
	}

	backup = backupPath(ConfigPath, time.Now())
	if err := atomicWrite(backup, data, info.Mode().Perm()); err != nil {
		return nil, "", errors.Join(append(failures, fmt.Errorf("backup config: %w", err))...)
	}
	restore := func(cause error) ([]AgentOptionEdit, string, error) {
		if rerr := atomicWrite(ConfigPath, data, info.Mode().Perm()); rerr != nil {
			cause = fmt.Errorf("%w; restore from %s failed: %v", cause, backup, rerr)
		}
		return nil, backup, errors.Join(append(failures, cause)...)
	}
	if err := writeRawConfig(cur); err != nil {
		return restore(fmt.Errorf("write config: %w", err))
	}
	if testAfterAgentOptionsWrite != nil {
		testAfterAgentOptionsWrite()
	}

	// Re-read what is on disk: it must equal the original (as writeRawConfig
	// formats it) plus exactly the applied keys, and it must still Load.
	got, err := os.ReadFile(ConfigPath)
	if err != nil {
		return restore(fmt.Errorf("re-read config: %w", err))
	}
	gotDoc, err := parseTomlDoc(string(got))
	if err != nil {
		return restore(fmt.Errorf("written config does not parse: %w", err))
	}
	want, err := parseTomlDoc(formatTOML(raw))
	if err != nil {
		return restore(fmt.Errorf("parse formatted original: %w", err))
	}
	for _, e := range applied {
		setDocAgentOption(want, projectIndex(cfg, e.Project), e.Key, e.Value)
	}
	if !reflect.DeepEqual(want, gotDoc) {
		return restore(fmt.Errorf("written config changed more than the intended keys"))
	}
	if _, err := Load(ConfigPath); err != nil {
		return restore(fmt.Errorf("written config does not load: %w", err))
	}
	return applied, backup, errors.Join(failures...)
}

// MigrateYoloDefaults runs once per data dir: every role whose agent options
// have no "mode" key and whose type has a known full-auto mode
// (core.KnownAgentYoloMode) gets that mode written, the same default new roles
// get from the setup wizard. Roles with any mode (default, plan, …) and other
// agent types are left alone (HintRolesWithoutKnownMode logs those). The run is marked done only when every role was
// written or permanently skipped (a role whose options cannot be patched as
// text, e.g. an inline table or dotted keys); an I/O failure leaves it unmarked
// so the next start retries (roles written meanwhile are skipped because they
// now have a mode). A symlinked config.toml is left alone entirely.
func MigrateYoloDefaults(dataDir string, cfg *Config) (applied []AgentOptionEdit, backup string, err error) {
	done, err := migrationDone(dataDir, YoloDefaultMigrationID)
	if err != nil || done {
		return nil, "", err
	}
	if ConfigPath != "" {
		if fi, lerr := os.Lstat(ConfigPath); lerr == nil && fi.Mode()&os.ModeSymlink != 0 {
			slog.Warn("upgrade: config.toml is a symlink, permission-mode migration skipped", "path", ConfigPath)
			return nil, "", nil
		}
	}
	var edits []AgentOptionEdit
	for _, p := range cfg.Projects {
		if _, ok := p.Agent.Options["mode"]; ok {
			continue
		}
		mode, ok := core.KnownAgentYoloMode(p.Agent.Type)
		if !ok {
			continue
		}
		edits = append(edits, AgentOptionEdit{Project: p.Name, Key: "mode", Value: mode})
	}
	if len(edits) > 0 {
		applied, backup, err = SetAgentOptionsIfAbsent(edits)
		for _, e := range applied {
			slog.Info("upgrade: role without a permission mode set to full-auto", "project", e.Project, "mode", e.Value, "backup", backup)
		}
		if err != nil && !onlyRoleSkips(err) {
			return applied, backup, err
		}
	}
	if merr := markMigrationDone(dataDir, YoloDefaultMigrationID); merr != nil {
		return applied, backup, errors.Join(err, merr)
	}
	return applied, backup, err
}

// HintRolesWithoutKnownMode runs once per data dir: every role with no "mode"
// key whose type has no known full-auto mode (core.KnownAgentYoloMode: dsh,
// acp, …) gets one warning saying its approval mode was not changed and how to
// set it. Nothing is written to config.toml: for these types there is no
// verified mode value to write (Cursor's `agent acp` only offers the session
// modes agent / plan / ask, none of which skips approval). hinted lists the
// projects that were logged.
func HintRolesWithoutKnownMode(dataDir string, cfg *Config) (hinted []string, err error) {
	done, err := migrationDone(dataDir, ModeHintMigrationID)
	if err != nil || done {
		return nil, err
	}
	for _, p := range cfg.Projects {
		if _, ok := p.Agent.Options["mode"]; ok {
			continue
		}
		if _, ok := core.KnownAgentYoloMode(p.Agent.Type); ok {
			continue
		}
		attrs := []any{"project", p.Name, "type", p.Agent.Type,
			"how_to_set", "web: role details > permission mode, or config.toml: mode under [projects.agent.options]"}
		if isCursorACP(p.Agent.Options) {
			attrs = append(attrs, "note", "Cursor ACP offers the session modes agent/plan/ask; none of them skips approval")
		}
		slog.Warn("upgrade: role permission mode not set automatically (no known full-auto mode for this agent type); it may still ask for approval", attrs...)
		hinted = append(hinted, p.Name)
	}
	if err := markMigrationDone(dataDir, ModeHintMigrationID); err != nil {
		return hinted, err
	}
	return hinted, nil
}

// isCursorACP reports whether acp agent options run Cursor's CLI as an ACP
// server: cmd (or command) is "agent" or "cursor-agent" and args contain "acp".
func isCursorACP(opts map[string]any) bool {
	cmd, _ := opts["cmd"].(string)
	if cmd == "" {
		cmd, _ = opts["command"].(string)
	}
	fields := strings.Fields(cmd)
	if len(fields) == 0 {
		return false
	}
	base := strings.TrimSuffix(strings.ToLower(filepath.Base(fields[0])), ".exe")
	if base != "agent" && base != "cursor-agent" {
		return false
	}
	args := append([]string(nil), fields[1:]...)
	switch a := opts["args"].(type) {
	case []string:
		args = append(args, a...)
	case []any:
		for _, v := range a {
			if s, ok := v.(string); ok {
				args = append(args, s)
			}
		}
	}
	for _, a := range args {
		if a == "acp" {
			return true
		}
	}
	return false
}

// roleSkipError marks a role that cannot be migrated because of how its config
// is written; retrying will not help.
type roleSkipError struct{ err error }

func (e roleSkipError) Error() string { return e.err.Error() }
func (e roleSkipError) Unwrap() error { return e.err }

func roleSkipped(err error) error { return roleSkipError{err} }

// onlyRoleSkips reports whether err (possibly an errors.Join) holds nothing but
// roleSkipError values.
func onlyRoleSkips(err error) bool {
	if err == nil {
		return true
	}
	if _, ok := err.(roleSkipError); ok {
		return true
	}
	if j, ok := err.(interface{ Unwrap() []error }); ok {
		for _, e := range j.Unwrap() {
			if !onlyRoleSkips(e) {
				return false
			}
		}
		return len(j.Unwrap()) > 0
	}
	return false
}

// RestoreConfigBackup puts a backup returned by SetAgentOptionsIfAbsent back.
func RestoreConfigBackup(backup string) error {
	configMu.Lock()
	defer configMu.Unlock()
	data, err := os.ReadFile(backup)
	if err != nil {
		return err
	}
	perm := os.FileMode(0o600)
	if info, err := os.Stat(ConfigPath); err == nil {
		perm = info.Mode().Perm()
	}
	return atomicWrite(ConfigPath, data, perm)
}

func parseTomlDoc(raw string) (map[string]any, error) {
	doc := map[string]any{}
	if _, err := toml.Decode(raw, &doc); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return doc, nil
}

func projectIndex(cfg *Config, name string) int {
	for i := range cfg.Projects {
		if cfg.Projects[i].Name == name {
			return i
		}
	}
	return -1
}

// setDocAgentOption sets projects[idx].agent.options[key] in a generic TOML doc.
func setDocAgentOption(doc map[string]any, idx int, key, value string) bool {
	projects, ok := doc["projects"].([]map[string]any)
	if !ok || idx < 0 || idx >= len(projects) {
		return false
	}
	agent, ok := projects[idx]["agent"].(map[string]any)
	if !ok {
		return false
	}
	opts, ok := agent["options"].(map[string]any)
	if !ok {
		if _, exists := agent["options"]; exists {
			return false
		}
		opts = map[string]any{}
		agent["options"] = opts
	}
	opts[key] = value
	return true
}

type migrationsState struct {
	Done map[string]string `json:"done"`
}

func readMigrations(dataDir string) (migrationsState, error) {
	var st migrationsState
	data, err := os.ReadFile(filepath.Join(dataDir, migrationsFile))
	if os.IsNotExist(err) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	if err := json.Unmarshal(data, &st); err != nil {
		return st, fmt.Errorf("parse %s: %w", migrationsFile, err)
	}
	return st, nil
}

func migrationDone(dataDir, id string) (bool, error) {
	st, err := readMigrations(dataDir)
	if err != nil {
		return false, err
	}
	_, ok := st.Done[id]
	return ok, nil
}

func markMigrationDone(dataDir, id string) error {
	st, err := readMigrations(dataDir)
	if err != nil {
		return err
	}
	if st.Done == nil {
		st.Done = map[string]string{}
	}
	st.Done[id] = time.Now().Format(time.RFC3339)
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	return atomicWrite(filepath.Join(dataDir, migrationsFile), append(data, '\n'), 0o644)
}

// ErrNonStandardOptionsTable means a project's agent options are written as an
// inline table or dotted keys, so the migration does not patch them as text.
var ErrNonStandardOptionsTable = errors.New("agent options are not a [projects.agent.options] table (inline or dotted keys), skipped")

// hasNonStandardOptionsTable reports whether project idx has options that are
// not under a [projects.agent.options] header (inline table or dotted keys such
// as options.work_dir = ...). Adding a header would define the table twice:
// BurntSushi accepts that, tomllib does not. Migration-only: interactive saves
// (SaveAgentModel etc.) keep the old behavior.
func hasNonStandardOptionsTable(raw string, idx int, hasOptions bool) bool {
	if !hasOptions {
		return false
	}
	lines, _ := splitConfigLines(raw)
	spans := buildRawProjectSpans(lines)
	if idx >= len(spans) {
		return false
	}
	return spans[idx].agentOptionsStart < 0
}
