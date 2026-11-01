package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestAskOnlyGuardInstalled: ask-only-guard is installed for each CLI in use, with its shell and edit tools in
// the matcher. Grok matches the Claude Code names in its matcher against its own tools.
func TestAskOnlyGuardInstalled(t *testing.T) {
	useRepoHooks(t)
	t.Setenv("HOME", t.TempDir())
	for cli, tools := range map[string][]string{
		"claudecode":  {"Bash", "Edit", "Write"},
		"dsh":         {"bash", "edit", "write"},
		"codex":       {"Bash", "apply_patch"},
		"antigravity": {"run_command", "write_to_file", "replace_file_content"},
		"grok":        {"Bash", "Edit", "Write", "--grok"},
	} {
		t.Run(cli, func(t *testing.T) {
			wd := t.TempDir()
			o := AgentHookOptions{DataDir: t.TempDir(), WorkDir: wd, CLI: cli, Lang: "en"}
			file := AgentHookSettingsPath(cli, wd)
			switch cli {
			case "antigravity":
				file = AgyHookFile(wd)
			case "dsh":
				o.DSHHome = t.TempDir()
				o.DSHPatch = filepath.Join(t.TempDir(), "role.patch.yml")
				o.DSHBridge = filepath.Join(t.TempDir(), "node_modules", "@deepseek-ai", "dsh-hooks-claude-code", "lib", "index.js")
				_ = os.MkdirAll(filepath.Dir(o.DSHBridge), 0o755)
				_ = os.WriteFile(o.DSHBridge, []byte("export {}\n"), 0o644)
			}
			if _, err := EnableAgentHooks(o); err != nil {
				t.Fatal(err)
			}
			b, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			s := string(b)
			if !strings.Contains(s, "ask-only-guard") {
				t.Fatalf("ask-only-guard not installed: %s", s)
			}
			for _, tool := range tools {
				if !strings.Contains(s, tool) {
					t.Errorf("matcher lacks %q: %s", tool, s)
				}
			}
		})
	}
}
