package core

import (
	"bytes"
	"fmt"
	"github.com/BurntSushi/toml"
	"os"
	"path/filepath"
)

// Kimi Code supports KIMI_CODE_HOME, not a documented project config layer.
// Keep config, login and runtime state inside this role; never mutate the user's home.
func KimiHookHome(workDir string) string {
	p, _ := filepath.Abs(filepath.Join(workDir, ".bothouse", "kimi-home"))
	return p
}
func KimiHookConfigPath(workDir string) string {
	return filepath.Join(KimiHookHome(workDir), "config.toml")
}
func KimiHookHomeIfPresent(workDir string) string {
	if _, err := os.Stat(KimiHookConfigPath(workDir)); err == nil {
		return KimiHookHome(workDir)
	}
	return ""
}
func readKimiHooks(workDir string) (map[string]any, []map[string]any, error) {
	c := map[string]any{}
	b, e := os.ReadFile(KimiHookConfigPath(workDir))
	if os.IsNotExist(e) {
		return c, nil, nil
	}
	if e != nil {
		return nil, nil, e
	}
	if _, e = toml.Decode(string(b), &c); e != nil {
		return nil, nil, fmt.Errorf("Kimi config unchanged: %w", e)
	}
	var rules []map[string]any
	switch v := c["hooks"].(type) {
	case []map[string]any:
		rules = v
	case []any:
		for _, x := range v {
			m, ok := x.(map[string]any)
			if !ok {
				return nil, nil, fmt.Errorf("invalid Kimi hook rule")
			}
			rules = append(rules, m)
		}
	case nil:
	default:
		return nil, nil, fmt.Errorf("Kimi hooks must be a TOML array of tables")
	}
	return c, rules, nil
}
func KimiHooksStatus(workDir string) (*AgentHookResult, error) {
	_, rules, e := readKimiHooks(workDir)
	if e != nil {
		return nil, e
	}
	r := &AgentHookResult{SettingsFile: KimiHookConfigPath(workDir), PersonaFile: filepath.Join(workDir, "AGENTS.md"), Enabled: []string{}}
	for _, h := range rules {
		cmd, _ := h["command"].(string)
		if ourHook(cmd) == "bash-guard" {
			r.Enabled = []string{"bash-guard"}
			break
		}
	}
	return r, nil
}
func setKimiHooks(o AgentHookOptions, on bool) (*AgentHookResult, error) {
	if o.WorkDir == "" {
		return nil, fmt.Errorf("work_dir is empty")
	}
	for _, n := range o.Only {
		if n != "bash-guard" {
			return nil, fmt.Errorf("Kimi hook %q not adapted; only bash-guard is verified", n)
		}
	}
	c, rules, e := readKimiHooks(o.WorkDir)
	if e != nil {
		return nil, e
	}
	kept := []map[string]any{}
	for _, h := range rules {
		cmd, _ := h["command"].(string)
		if ourHook(cmd) == "" {
			kept = append(kept, h)
		}
	}
	python, e := FindPython()
	if e != nil {
		return nil, e
	}
	dir := AgentHooksDir(o.DataDir)
	if on {
		dir, e = InstallAgentHookScripts(o.DataDir)
		if e != nil {
			return nil, e
		}
		kept = append(kept, map[string]any{"event": "PreToolUse", "matcher": "^Bash$", "command": agentHookCommand(python, dir, "bash-guard", "--role", o.WorkDir, "--kimi"), "timeout": 10})
	}
	c["hooks"] = kept
	var b bytes.Buffer
	if e = toml.NewEncoder(&b).Encode(c); e != nil {
		return nil, e
	}
	path := KimiHookConfigPath(o.WorkDir)
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return nil, e
	}
	if e = AtomicWriteFile(path, b.Bytes(), 0600); e != nil {
		return nil, e
	}
	res, e := KimiHooksStatus(o.WorkDir)
	if e != nil {
		return nil, e
	}
	res.HooksDir = dir
	if e = writeHookRules(res.PersonaFile, o.Lang, res.Enabled, python, dir, o.WorkDir); e != nil {
		return nil, e
	}
	return res, nil
}
