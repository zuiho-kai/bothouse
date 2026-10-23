package codex

import (
	"fmt"
	"log/slog"
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

func isBothouseCodexHook(h appServerHookMetadata) bool {
	if h.Key == "" || h.CurrentHash == "" || !strings.EqualFold(h.HandlerType, "command") {
		return false
	}
	for _, m := range bothouseHookMarks {
		if !strings.Contains(h.Command, " "+m+" ") {
			return false
		}
	}
	switch strings.ToLower(h.TrustStatus) {
	case "untrusted", "modified":
		return true
	}
	return false
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

func (s *appServerSession) trustBothouseHooks() error {
	if strings.TrimSpace(s.workDir) == "" {
		return nil
	}
	// Hook keys embed the source path, and the thread may run under the
	// symlink-resolved cwd (macOS /tmp -> /private/tmp), so list both spellings.
	cwds := []string{s.workDir}
	if real, err := filepath.EvalSymlinks(s.workDir); err == nil && real != s.workDir {
		cwds = append(cwds, real)
	}
	var resp appServerHooksListResponse
	if err := s.request("hooks/list", map[string]any{"cwds": cwds}, &resp); err != nil {
		return fmt.Errorf("codex app-server hooks/list: %w", err)
	}
	edits := hookTrustEdits(resp)
	if edits == nil {
		return nil
	}
	if err := s.request("config/batchWrite", map[string]any{"edits": edits, "reloadUserConfig": true}, nil); err != nil {
		return fmt.Errorf("codex app-server trust hooks: %w", err)
	}
	slog.Info("codex app-server: trusted bothouse hooks", "count", len(edits[0]["value"].(map[string]any)), "work_dir", s.workDir)
	return nil
}
