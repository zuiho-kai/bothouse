package codex

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// Codex skips project hooks whose hash is not recorded in the user config
// (codex-rs/hooks/src/engine/discovery.rs:679-719 at rust-v0.163.0-alpha.11),
// and app-server has no bypass flag, so bothouse records trust for the hooks it
// installed itself, the same way Codex's own app-server does
// (app-server/tests/suite/v2/thread_goal_empty_responses.rs:113-128):
// hooks/list -> config/batchWrite hooks.state.<key>.trusted_hash = currentHash.
// The write lands in the session's CODEX_HOME config.toml.

type appServerHooksListResponse struct {
	Data []struct {
		Hooks []appServerHookMetadata `json:"hooks"`
	} `json:"data"`
}

type appServerHookMetadata struct {
	Key         string `json:"key"`
	HandlerType string `json:"handlerType"`
	Command     string `json:"command"`
	CurrentHash string `json:"currentHash"`
	TrustStatus string `json:"trustStatus"`
}

// bothouseHookMarks are written into every Codex hook command by
// core.EnableAgentHooks (core/agent_hooks.go agentHookMark + the --codex option).
var bothouseHookMarks = []string{"--conest-hook", "--codex"}

// isBothouseCodexCommand: cmd is a hook command bothouse installed for Codex.
func isBothouseCodexCommand(cmd string) bool {
	fields := strings.Fields(cmd)
	for _, m := range bothouseHookMarks {
		found := false
		for _, f := range fields {
			if f == m {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// isUntrustedHook: Codex lists the hook but will skip it until trusted_hash is recorded.
func isUntrustedHook(h appServerHookMetadata) bool {
	switch strings.ToLower(h.TrustStatus) {
	case "untrusted", "modified":
		return true
	}
	return false
}

func isBothouseCodexHook(h appServerHookMetadata) bool {
	if h.Key == "" || h.CurrentHash == "" || !strings.EqualFold(h.HandlerType, "command") {
		return false
	}
	return isBothouseCodexCommand(h.Command) && isUntrustedHook(h)
}

// bothouseCodexHooks: the bothouse Codex hooks hooks/list reported, whatever their trust status.
func bothouseCodexHooks(resp appServerHooksListResponse) []appServerHookMetadata {
	var out []appServerHookMetadata
	for _, entry := range resp.Data {
		for _, h := range entry.Hooks {
			if isBothouseCodexCommand(h.Command) && strings.EqualFold(h.HandlerType, "command") {
				out = append(out, h)
			}
		}
	}
	return out
}

// bothouseCodexHookCommands: the bothouse Codex hook commands in the role's .codex/hooks.json (none when the
// role installs no bothouse Codex hooks). Trust registration must cover every one of them.
func bothouseCodexHookCommands(workDir string) ([]string, error) {
	path := filepath.Join(workDir, ".codex", "hooks.json")
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	var doc struct {
		Hooks map[string][]struct {
			Hooks []struct {
				Command string `json:"command"`
			} `json:"hooks"`
		} `json:"hooks"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("%s is not valid JSON: %w", path, err)
	}
	var cmds []string
	for _, groups := range doc.Hooks {
		for _, g := range groups {
			for _, h := range g.Hooks {
				if isBothouseCodexCommand(h.Command) {
					cmds = append(cmds, h.Command)
				}
			}
		}
	}
	return cmds, nil
}

// hookTrustEdits returns the config edit trusting bothouse's own untrusted hooks, or nil.
func hookTrustEdits(resp appServerHooksListResponse) []map[string]any {
	state := map[string]any{}
	for _, entry := range resp.Data {
		for _, h := range entry.Hooks {
			if isBothouseCodexHook(h) {
				state[h.Key] = map[string]any{"trusted_hash": h.CurrentHash}
			}
		}
	}
	if len(state) == 0 {
		return nil
	}
	return []map[string]any{{"keyPath": "hooks.state", "value": state, "mergeStrategy": "upsert"}}
}

// trustBothouseHooks records trusted_hash for the hooks bothouse installed in this role, so Codex runs them
// instead of skipping them silently. Every failure is returned: a session whose bash-guard would not run must
// not start (the hook is the guard, not a nicety).
func (s *appServerSession) trustBothouseHooks() error {
	if strings.TrimSpace(s.workDir) == "" {
		return nil
	}
	// What this role should have: read the file Codex discovers, so "hooks/list did not report them" is caught
	// here instead of turning into a silently untrusted session.
	want, err := bothouseCodexHookCommands(s.workDir)
	if err != nil {
		return fmt.Errorf("read the role's bothouse hooks: %w", err)
	}
	if len(want) == 0 {
		return nil // this role has no bothouse Codex hooks: nothing to register
	}
	// Hook keys embed the source path, and the thread may run under the
	// symlink-resolved cwd (macOS /tmp -> /private/tmp), so list both spellings.
	cwds := []string{s.workDir}
	if real, err := filepath.EvalSymlinks(s.workDir); err == nil && real != s.workDir {
		cwds = append(cwds, real)
	}
	// Codex only loads project hooks (.codex/hooks.json) in trusted projects, and a fresh CODEX_HOME trusts
	// nothing, so record trust for the role's own directory first. The hooks/list below runs after the write
	// (and its reloadUserConfig), so it already sees the project trusted.
	projectHint, err := s.trustRoleProject(cwds)
	if err != nil {
		return err
	}
	var resp appServerHooksListResponse
	if err := s.request("hooks/list", map[string]any{"cwds": cwds}, &resp); err != nil {
		return fmt.Errorf("step 1/3 hooks/list: %w", err)
	}
	listed := bothouseCodexHooks(resp)
	seen := map[string]bool{}
	for _, h := range listed {
		seen[h.Command] = true
	}
	var missing []string
	for _, cmd := range want {
		if !seen[cmd] {
			missing = append(missing, cmd)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("step 2/3 hooks/list: Codex did not report %d of the %d bothouse hooks in %s (cwds %s), so it would skip them%s: %s",
			len(missing), len(want), filepath.Join(s.workDir, ".codex", "hooks.json"), strings.Join(cwds, ", "), projectHint, strings.Join(missing, "; "))
	}
	edits := hookTrustEdits(resp)
	if edits != nil {
		if err := s.request("config/batchWrite", map[string]any{"edits": edits, "reloadUserConfig": true}, nil); err != nil {
			return fmt.Errorf("step 3/3 config/batchWrite (hooks.state.trusted_hash): %w", err)
		}
	}
	// Verify the write landed: a config write that reports success but is not read back is the same silent
	// skip as no write at all. Codex reads trust from the same config it just reloaded.
	var after appServerHooksListResponse
	if err := s.request("hooks/list", map[string]any{"cwds": cwds}, &after); err != nil {
		return fmt.Errorf("step 3/3 verify hooks/list: %w", err)
	}
	var left []string
	for _, h := range bothouseCodexHooks(after) {
		if isUntrustedHook(h) {
			left = append(left, h.Key)
		}
	}
	if len(left) > 0 {
		return fmt.Errorf("step 3/3 verify: Codex still reports %d bothouse hooks untrusted after the write: %s",
			len(left), strings.Join(left, ", "))
	}
	slog.Info("codex app-server: trusted bothouse hooks", "count", len(listed), "work_dir", s.workDir)
	return nil
}

type appServerConfigReadResponse struct {
	Config struct {
		Projects map[string]struct {
			TrustLevel *string `json:"trust_level"`
		} `json:"projects"`
	} `json:"config"`
}

// projectTrustEdits returns the config edit trusting the cwds that have no trust_level yet, or nil. A
// trust_level the user already set (including "untrusted") is left alone.
func projectTrustEdits(cfg appServerConfigReadResponse, cwds []string) []map[string]any {
	add := map[string]any{}
	for _, cwd := range cwds {
		if p, ok := cfg.Config.Projects[cwd]; ok && p.TrustLevel != nil {
			continue
		}
		add[cwd] = map[string]any{"trust_level": "trusted"}
	}
	if len(add) == 0 {
		return nil
	}
	return []map[string]any{{"keyPath": "projects", "value": add, "mergeStrategy": "upsert"}}
}

// trustRoleProject marks the role directory as a trusted Codex project when the session's config says
// nothing about it. Codex writes its own config.toml through config/batchWrite, so the write lands in the
// session's CODEX_HOME and other keys and projects stay as they are. hint explains a later hooks/list miss
// when the user's config keeps the project untrusted.
func (s *appServerSession) trustRoleProject(cwds []string) (hint string, err error) {
	var cfg appServerConfigReadResponse
	if err := s.request("config/read", map[string]any{}, &cfg); err != nil {
		return "", fmt.Errorf("step 0/3 config/read (projects trust): %w", err)
	}
	for _, cwd := range cwds {
		if p, ok := cfg.Config.Projects[cwd]; ok && p.TrustLevel != nil && !strings.EqualFold(*p.TrustLevel, "trusted") {
			hint = fmt.Sprintf(" (the Codex config sets projects.%q.trust_level = %q; bothouse does not override it)", cwd, *p.TrustLevel)
		}
	}
	edits := projectTrustEdits(cfg, cwds)
	if edits == nil {
		return hint, nil
	}
	if err := s.request("config/batchWrite", map[string]any{"edits": edits, "reloadUserConfig": true}, nil); err != nil {
		return "", fmt.Errorf("step 0/3 config/batchWrite (projects trust_level): %w", err)
	}
	slog.Info("codex app-server: trusted role project", "cwds", strings.Join(cwds, ", "))
	return hint, nil
}
