package core

import (
	"context"
	"testing"
)

func TestDefaultAgentYoloMode(t *testing.T) {
	tests := []struct {
		agentType string
		want      string
	}{
		{"claudecode", "bypassPermissions"},
		{"ClaudeCode", "bypassPermissions"},
		{"copilot", "bypassPermissions"},
		{"cursor", "force"},
		{"codex", "yolo"},
		{"gemini", "yolo"},
		{"antigravity", "yolo"},
		{"pi", "yolo"},
		{"qoder", "yolo"},
		{"opencode", "yolo"},
		{"kimi", "yolo"},
		{"iflow", "yolo"},
		{"reasonix", "yolo"},
		{"dsh", "yolo"},
		{"unknown-agent", "yolo"},
		{"", "yolo"},
	}

	for _, tt := range tests {
		got := DefaultAgentYoloMode(tt.agentType)
		if got != tt.want {
			t.Errorf("DefaultAgentYoloMode(%q) = %q, want %q", tt.agentType, got, tt.want)
		}
	}
}

// First-run wizard: all new roles default to their respective YOLO permission modes.
func TestApplyWizard_FirstRunDefaultsToYolo(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}

	req := cloudWebReq(hub.URL, "bot-secret",
		WizardRole{Name: "claude-bot", AgentType: "claudecode"},
		WizardRole{Name: "codex-bot", AgentType: "codex"},
		WizardRole{Name: "gemini-bot", AgentType: "gemini"},
		WizardRole{Name: "cursor-bot", AgentType: "cursor"},
	)

	res := ApplyWizard(context.Background(), env, req)
	if !res.Saved {
		t.Fatalf("first run failed: %+v", res)
	}

	expected := map[string]string{
		"claude-bot": "bypassPermissions",
		"codex-bot":  "yolo",
		"gemini-bot": "yolo",
		"cursor-bot": "force",
	}

	for name, wantMode := range expected {
		p := store.projects[name]
		if p == nil {
			t.Fatalf("project %q not created", name)
		}
		if p.AgentOptions == nil {
			t.Fatalf("project %q has nil AgentOptions", name)
		}
		if got := p.AgentOptions["mode"]; got != wantMode {
			t.Errorf("project %q mode = %v, want %q", name, got, wantMode)
		}
	}
}

// Append mode: newly added roles default to their respective YOLO permission mode.
func TestApplyWizard_AppendModeDefaultsToYolo(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}

	// First run creates role "a"
	req1 := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a", AgentType: "claudecode"})
	if res := ApplyWizard(context.Background(), env, req1); !res.Saved {
		t.Fatalf("first run failed: %+v", res)
	}

	// Append mode adds role "b" (gemini) and role "c" (cursor)
	req2 := cloudWebReq(hub.URL, "bot-secret",
		WizardRole{Name: "b", AgentType: "gemini"},
		WizardRole{Name: "c", AgentType: "cursor"},
	)
	req2.AppendOnly = true

	res2 := ApplyWizard(context.Background(), env, req2)
	if !res2.Saved {
		t.Fatalf("append run failed: %+v", res2)
	}

	if p := store.projects["b"]; p == nil || p.AgentOptions["mode"] != "yolo" {
		t.Fatalf("project b mode = %v, want yolo", p.AgentOptions["mode"])
	}
	if p := store.projects["c"]; p == nil || p.AgentOptions["mode"] != "force" {
		t.Fatalf("project c mode = %v, want force", p.AgentOptions["mode"])
	}
}

// Preserves existing role's configured mode: existing projects are NOT overwritten to YOLO.
func TestApplyWizard_PreservesExistingRoleMode(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}

	// Create initial project with custom mode "plan"
	store.projects["existing-bot"] = &WizardProjectWrite{
		Name:         "existing-bot",
		AgentType:    "claudecode",
		PlatformType: "cloud_web",
		AgentOptions: map[string]any{"mode": "plan"},
		Options:      map[string]any{},
	}
	store.order = []string{"existing-bot"}

	// 1. Rerun plain wizard with existing-bot
	req1 := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "existing-bot", AgentType: "claudecode"})
	res1 := ApplyWizard(context.Background(), env, req1)
	if !res1.Saved {
		t.Fatalf("plain rerun failed: %+v", res1)
	}
	if p := store.projects["existing-bot"]; p.AgentOptions["mode"] != "plan" {
		t.Fatalf("existing role mode overwritten on rerun: got %v, want plan", p.AgentOptions["mode"])
	}

	// 2. Append mode adding a new bot
	req2 := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "new-bot", AgentType: "gemini"})
	req2.AppendOnly = true
	res2 := ApplyWizard(context.Background(), env, req2)
	if !res2.Saved {
		t.Fatalf("append failed: %+v", res2)
	}

	// Existing bot remains "plan"
	if p := store.projects["existing-bot"]; p.AgentOptions["mode"] != "plan" {
		t.Fatalf("existing role mode overwritten on append: got %v, want plan", p.AgentOptions["mode"])
	}
	// New bot gets "yolo"
	if p := store.projects["new-bot"]; p.AgentOptions["mode"] != "yolo" {
		t.Fatalf("new role mode = %v, want yolo", p.AgentOptions["mode"])
	}
}
