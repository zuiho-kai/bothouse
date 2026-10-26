package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The real binary registers agents through cmd/cc-connect/plugin_agent_*.go; core tests
// import none of them, so stand in for every agent the wizard knows about.
func init() {
	stub := func(map[string]any) (Agent, error) { return nil, nil }
	for _, s := range cliSpecs {
		if _, ok := agentFactories[s.agentType]; s.agentType != "" && !ok {
			RegisterAgent(s.agentType, stub)
		}
	}
	others := []string{"acp", "devin", "tmux"} // registered by the binary, not detected as a CLI
	for t := range memoryFileOfAgent {
		others = append(others, t)
	}
	for _, t := range others {
		if _, ok := agentFactories[t]; !ok {
			RegisterAgent(t, stub)
		}
	}
}

func TestCanonicalAgentTypeMapsBinaryNames(t *testing.T) {
	for in, want := range map[string]string{
		"claude": "claudecode", "claudecode": "claudecode", "agy": "antigravity",
		"cursor-agent": "cursor", "qodercli": "qoder", "codex": "codex", " dsh ": "dsh",
	} {
		got, err := canonicalAgentType(in)
		if err != nil || got != want {
			t.Errorf("canonicalAgentType(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"workbuddy", "codebuddy", "totally-unknown-agent"} {
		if got, err := canonicalAgentType(in); err == nil || !strings.Contains(err.Error(), "unknown agent type") {
			t.Errorf("canonicalAgentType(%q) = %q, %v; want unknown agent type", in, got, err)
		}
	}
}

func TestApplyWizardClaudeBinaryNameWritesClaudecode(t *testing.T) {
	useRepoHooks(t)
	useRepoWiki(t)
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	data := t.TempDir()
	t.Setenv("WIKI_DIR", filepath.Join(data, "main-wiki"))
	store := &hookMemStore{memStore: newMemStore()}
	req := cloudWebReq(hub.URL, "bot-secret",
		WizardRole{Name: "Writer", Project: "writer", AgentType: "claude", Persona: "PERSONA_WRITER"})
	res := ApplyWizard(context.Background(), WizardEnv{
		Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{},
	}, req)
	if !res.OK || !res.Saved || len(res.Roles) != 1 {
		t.Fatalf("apply: %+v", res)
	}
	work := filepath.Join(data, "roles", "writer")
	if r := res.Roles[0]; r.AgentType != "claudecode" || r.PersonaFile != filepath.Join(work, "CLAUDE.md") {
		t.Fatalf("role: %+v", r)
	}
	if p := store.projects["writer"]; p == nil || p.AgentType != "claudecode" {
		t.Fatalf("config project: %+v", p)
	}
	if b, err := os.ReadFile(filepath.Join(work, "CLAUDE.md")); err != nil || !strings.Contains(string(b), "PERSONA_WRITER") {
		t.Fatalf("CLAUDE.md: %q (%v)", b, err)
	}
	if fileExists(filepath.Join(work, "AGENTS.md")) {
		t.Fatal("persona also went to AGENTS.md")
	}
}

func TestApplyWizardUnknownAgentTypeWritesNothing(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	for _, dry := range []bool{false, true} {
		data := t.TempDir()
		store := newMemStore()
		req := cloudWebReq(hub.URL, "bot-secret",
			WizardRole{Name: "Writer", Project: "writer", AgentType: "workbuddy", Persona: "P"})
		req.DryRun = dry
		res := ApplyWizard(context.Background(), WizardEnv{
			Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{},
		}, req)
		if res.OK || res.Saved || !strings.Contains(res.Error, "unknown agent type") {
			t.Fatalf("dry=%v: unknown agent type should fail: %+v", dry, res)
		}
		if store.batches != 0 || len(store.projects) != 0 {
			t.Fatalf("dry=%v: config written: batches=%d projects=%v", dry, store.batches, store.projects)
		}
		if fileExists(filepath.Join(data, "roles", "writer")) {
			t.Fatalf("dry=%v: role directory written", dry)
		}
	}
}
