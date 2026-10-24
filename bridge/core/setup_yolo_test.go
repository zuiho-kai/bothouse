package core

import (
	"context"
	"sync"
	"testing"
	"time"
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

type dshTestAgentSession struct {
	stubAgentSession
	events  chan Event
	mu      sync.Mutex
	calls   int
	lastID  string
	lastRes PermissionResult
}

func (s *dshTestAgentSession) Events() <-chan Event { return s.events }
func (s *dshTestAgentSession) RespondPermission(id string, res PermissionResult) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.lastID = id
	s.lastRes = res
	return nil
}

// TestDSH_DefaultYoloAutoApprovesPermission verifies that a new DSH role gets mode="yolo"
// from wizard defaults and automatically approves permission requests during interactive turns.
func TestDSH_DefaultYoloAutoApprovesPermission(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}

	// 1. Wizard creates DSH role
	RegisterAgent("dsh", func(opts map[string]any) (Agent, error) {
		mode, _ := opts["mode"].(string)
		return &stubModelModeAgent{mode: mode}, nil
	})
	req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "dsh-bot", AgentType: "dsh"})
	res := ApplyWizard(context.Background(), env, req)
	if !res.Saved {
		t.Fatalf("wizard failed: %+v", res)
	}

	pCfg := store.projects["dsh-bot"]
	if pCfg == nil || pCfg.AgentOptions["mode"] != "yolo" {
		t.Fatalf("expected DSH role to default to yolo mode, got: %v", pCfg)
	}

	// 2. Instantiate DSH agent with the options produced by wizard
	dshAgent, err := CreateAgent("dsh", pCfg.AgentOptions)
	if err != nil {
		t.Fatalf("CreateAgent(dsh) failed: %v", err)
	}

	if !isYoloMode(dshAgent) {
		t.Fatalf("expected isYoloMode(dshAgent) == true, got false")
	}

	// 3. Run interactive turn with dshAgent; verify EventPermissionRequest is auto-approved
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", dshAgent, []Platform{p}, "", LangEnglish)
	defer e.Stop()

	sess := &dshTestAgentSession{events: make(chan Event, 8)}
	key := "test:dsh-session"
	session := e.sessions.GetOrCreateActive(key)
	state := &interactiveState{
		agentSession: sess,
		platform:     p,
		replyCtx:     "ctx",
		agent:        dshAgent,
		approveAll:   isYoloMode(dshAgent),
	}
	e.interactiveMu.Lock()
	e.interactiveStates[key] = state
	e.interactiveMu.Unlock()

	sendDone := make(chan error, 1)
	sendDone <- nil
	done := make(chan struct{})
	go func() {
		e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, sendDone, nil)
		close(done)
	}()

	// Emit a permission request
	sess.events <- Event{
		Type:         EventPermissionRequest,
		RequestID:    "req-dsh-1",
		ToolName:     "bash",
		ToolInput:    "rm -rf /tmp/test",
		ToolInputRaw: map[string]any{"cmd": "rm -rf /tmp/test"},
	}

	// Emit result to finish turn
	sess.events <- Event{Type: EventResult, Content: "finished", Done: true}

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("turn timed out")
	}

	sess.mu.Lock()
	calls := sess.calls
	lastID := sess.lastID
	lastRes := sess.lastRes
	sess.mu.Unlock()

	if calls != 1 {
		t.Fatalf("expected 1 auto-approved RespondPermission call, got %d", calls)
	}
	if lastID != "req-dsh-1" {
		t.Fatalf("expected request ID req-dsh-1, got %q", lastID)
	}
	if lastRes.Behavior != "allow" {
		t.Fatalf("expected behavior allow, got %q", lastRes.Behavior)
	}
}
