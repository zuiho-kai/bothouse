package main

import (
	"reflect"
	"testing"

	"github.com/chenhg5/cc-connect/config"
)

// A role that runs Codex with its own codex_home must have its rollouts
// scanned too; before, only the default ~/.codex was read and that role's
// usage stayed at 0.
func TestCodexUsageHomesIncludesRoleHomes(t *testing.T) {
	projects := []config.ProjectConfig{
		{Name: "gge", Agent: config.AgentConfig{Type: "codex", Options: map[string]any{"codex_home": "/x/codex-home/gge"}}},
		{Name: "dup", Agent: config.AgentConfig{Type: "codex", Options: map[string]any{"codex_home": "/x/codex-home/gge/"}}},
		{Name: "env", Agent: config.AgentConfig{Type: "codex", Options: map[string]any{"env": map[string]any{"CODEX_HOME": "/x/env-home"}}}},
		{Name: "same", Agent: config.AgentConfig{Type: "codex", Options: map[string]any{"codex_home": "/x/default"}}},
		{Name: "claude", Agent: config.AgentConfig{Type: "claudecode", Options: map[string]any{}}},
	}
	got := codexUsageHomes("/x/default", projects)
	want := []string{"/x/default", "/x/codex-home/gge", "/x/env-home"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
