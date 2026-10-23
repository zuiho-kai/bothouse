package core

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
)

// CursorHookSettingsDir returns the .cursor directory for the given role workDir.
func CursorHookSettingsDir(workDir string) string {
	return filepath.Join(workDir, ".cursor")
}

// CursorHookSettingsPath returns the path to .cursor/hooks.json.
func CursorHookSettingsPath(workDir string) string {
	return filepath.Join(CursorHookSettingsDir(workDir), "hooks.json")
}

func readCursorHooksEnabled(workDir string) ([]string, error) {
	p := CursorHookSettingsPath(workDir)
	b, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	hooks, _ := raw["hooks"].(map[string]any)
	if hooks == nil {
		return nil, nil
	}
	items, _ := hooks["beforeShellExecution"].([]any)
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		cmd, _ := m["command"].(string)
		if ourHook(cmd) == "bash-guard" {
			return []string{"bash-guard"}, nil
		}
	}
	return nil, nil
}

// enableCursorHooks installs only verified hooks (bash-guard) into .cursor/hooks.json.
// It preserves existing user settings and other hooks, avoiding overwrite.
func enableCursorHooks(o AgentHookOptions, names []string, persona, python, dir string) (*AgentHookResult, error) {
	for _, n := range o.Only {
		if n != "bash-guard" {
			return nil, fmt.Errorf("Cursor hook %q not adapted; only bash-guard is verified", n)
		}
	}
	sp := CursorHookSettingsPath(o.WorkDir)
	raw := make(map[string]any)
	if b, err := os.ReadFile(sp); err == nil && len(b) > 0 {
		_ = json.Unmarshal(b, &raw)
	}
	if _, ok := raw["version"]; !ok {
		raw["version"] = 1
	}

	hooks, _ := raw["hooks"].(map[string]any)
	if hooks == nil {
		hooks = make(map[string]any)
		raw["hooks"] = hooks
	}

	// Filter out our existing bash-guard hook from beforeShellExecution, preserving other hooks
	var keep []any
	if existing, ok := hooks["beforeShellExecution"].([]any); ok {
		for _, item := range existing {
			m, ok := item.(map[string]any)
			if !ok {
				keep = append(keep, item)
				continue
			}
			cmd, _ := m["command"].(string)
			if ourHook(cmd) != "bash-guard" {
				keep = append(keep, item)
			}
		}
	}

	// Per verified documentation (https://cursor.com/docs/hooks), only bash-guard (beforeShellExecution) is installed.
	if slices.Contains(names, "bash-guard") {
		h, _ := agentHookByName("bash-guard")
		timeout := 10
		if h.Timeout > 0 {
			timeout = h.Timeout
		}
		cmd := agentHookCommand(python, dir, "bash-guard", "--role", o.WorkDir, "--cursor")
		keep = append(keep, map[string]any{
			"command": cmd,
			"timeout": timeout,
		})
	}
	hooks["beforeShellExecution"] = keep

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(CursorHookSettingsDir(o.WorkDir), 0o755); err != nil {
		return nil, fmt.Errorf("create .cursor dir: %w", err)
	}
	if err := AtomicWriteFile(sp, out, 0o644); err != nil {
		return nil, err
	}

	enabled, err := readCursorHooksEnabled(o.WorkDir)
	if err != nil {
		return nil, err
	}
	return &AgentHookResult{
		HooksDir:     dir,
		SettingsFile: sp,
		PersonaFile:  persona,
		Enabled:      enabled,
	}, nil
}

// disableCursorHooks removes our bash-guard hook while preserving user settings.
func disableCursorHooks(o AgentHookOptions, names []string, persona string) (*AgentHookResult, error) {
	sp := CursorHookSettingsPath(o.WorkDir)
	b, err := os.ReadFile(sp)
	if err == nil && len(b) > 0 {
		var raw map[string]any
		if err := json.Unmarshal(b, &raw); err == nil {
			if hooks, ok := raw["hooks"].(map[string]any); ok {
				if existing, ok := hooks["beforeShellExecution"].([]any); ok {
					var keep []any
					for _, item := range existing {
						m, ok := item.(map[string]any)
						if !ok {
							keep = append(keep, item)
							continue
						}
						cmd, _ := m["command"].(string)
						if ourHook(cmd) != "bash-guard" || !slices.Contains(names, "bash-guard") {
							keep = append(keep, item)
						}
					}
					if len(keep) > 0 {
						hooks["beforeShellExecution"] = keep
					} else {
						delete(hooks, "beforeShellExecution")
					}
				}
				if len(hooks) == 0 && len(raw) == 2 && raw["version"] == float64(1) {
					// Only version and empty hooks, safe to remove
					_ = os.Remove(sp)
				} else {
					out, _ := json.MarshalIndent(raw, "", "  ")
					_ = AtomicWriteFile(sp, out, 0o644)
				}
			}
		}
	}

	enabled, err := readCursorHooksEnabled(o.WorkDir)
	if err != nil {
		return nil, err
	}
	dir := AgentHooksDir(o.DataDir)
	return &AgentHookResult{
		HooksDir:     dir,
		SettingsFile: sp,
		PersonaFile:  persona,
		Enabled:      enabled,
	}, nil
}
