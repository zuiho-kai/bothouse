package core

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestQueuedModelSwitchDoesNotChangeOtherChannels(t *testing.T) {
	agent := &stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "astra", reasoningEffort: "medium"}, models: []ModelOption{{Name: "astra"}, {Name: "sol"}}}
	e := NewEngine("test", agent, nil, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	e.SetProjectStateStore(NewProjectStateStore(filepath.Join(t.TempDir(), "state.json")))
	var savedModel, savedEffort string
	e.SetModelSaveFunc(func(v string) error { savedModel = v; return nil })
	e.SetReasoningEffortSaveFunc(func(v string) error { savedEffort = v; return nil })
	if r := e.QueueModelSwitch(context.Background(), "discord:work", "sol", "high", false); !r.OK {
		t.Fatal(r)
	}
	e.applyPendingSwitch("discord:work")
	if got := e.ModelStatus(context.Background(), "discord:drame"); got.Model != "astra" || got.Effort != "medium" {
		t.Fatalf("switch leaked into drame: model=%q effort=%q", got.Model, got.Effort)
	}
	if got := e.ModelStatus(context.Background(), "discord:work"); got.Model != "sol" || got.Effort != "high" || got.Pending != "" {
		t.Fatalf("work status: %+v", got)
	}
	if savedModel != "" || savedEffort != "" {
		t.Fatalf("session switch overwrote project defaults: %q %q", savedModel, savedEffort)
	}
}

type scopedStartupAgent struct {
	stubModelModeAgent
}

type scopedStartupSession struct {
	stubAgentSession
	model, effort, id string
}

func (s *scopedStartupSession) GetModel() string           { return s.model }
func (s *scopedStartupSession) GetReasoningEffort() string { return s.effort }
func (s *scopedStartupSession) CurrentSessionID() string   { return s.id }

func (a *scopedStartupAgent) StartSession(ctx context.Context, id string) (AgentSession, error) {
	model, effort := SessionModelAndEffort(ctx, a.model, a.reasoningEffort)
	return &scopedStartupSession{model: model, effort: effort, id: id}, nil
}

// Exercise engine startup and reconstruction, rather than only status getters.
func TestCUJ_ModelScopeConcurrentChannelsAndReload(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	a := &scopedStartupAgent{stubModelModeAgent{model: "astra", reasoningEffort: "medium"}}
	e := NewEngine("test", a, nil, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	e.SetProjectStateStore(NewProjectStateStore(statePath))
	if err := e.saveSessionSelection("discord:work", "sol", "high"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, key := range []string{"discord:work", "discord:drame"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			s := e.sessions.GetOrCreateActive(key)
			s.SetAgentSessionID(key, "stub")
			state := e.getOrCreateInteractiveStateWith(key, &stubPlatformEngine{n: "test"}, nil, s, e.sessions, nil, key)
			got, ok := state.agentSession.(*scopedStartupSession)
			if !ok {
				t.Errorf("startup failed: %+v", state)
				return
			}
			wantModel, wantEffort := "astra", "medium"
			if key == "discord:work" {
				wantModel, wantEffort = "sol", "high"
			}
			if got.model != wantModel || got.effort != wantEffort || got.id != key {
				t.Errorf("%s startup = %+v", key, got)
			}
		}(key)
	}
	wg.Wait()
	reloaded := NewEngine("test", a, nil, "", LangEnglish)
	t.Cleanup(func() { reloaded.Stop() })
	reloaded.SetProjectStateStore(NewProjectStateStore(statePath))
	if got := reloaded.ModelStatus(context.Background(), "discord:work"); got.Model != "sol" || got.Effort != "high" {
		t.Fatal(got)
	}
	if a.model != "astra" || a.reasoningEffort != "medium" {
		t.Fatal("shared defaults changed")
	}
}

func TestModelScopePartialChangesAndNewConversation(t *testing.T) {
	a := &stubModelModeAgent{model: "astra", reasoningEffort: "medium"}
	e := NewEngine("test", a, nil, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	key := "discord:work"
	for _, change := range []sessionModelSelection{{Model: "sol", Effort: "high"}, {Effort: "low"}, {Model: `["provider","exact-model"]`}} {
		if err := e.saveSessionSelection(key, change.Model, change.Effort); err != nil {
			t.Fatal(err)
		}
	}
	e.sessions.NewSession(key, "")
	if got := e.sessionSettingsFor(key); got.Model != `["provider","exact-model"]` || got.ReasoningEffort != "low" {
		t.Fatal(got)
	}
}

func TestQueuedModelScopePersistenceFailureRetainsPending(t *testing.T) {
	a := &stubStrictModelAgent{models: []ModelOption{{Name: "sol"}}}
	e := NewEngine("test", a, nil, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blocked, []byte("file"), 0o600); err != nil {
		t.Fatal(err)
	}
	e.SetProjectStateStore(NewProjectStateStore(filepath.Join(blocked, "state.json")))
	if r := e.QueueModelSwitch(context.Background(), "discord:work", "sol", "high", false); !r.OK {
		t.Fatal(r)
	}
	if err := e.applyPendingSwitchOnAgent(a, "discord:work"); err == nil {
		t.Fatal("expected write failure")
	}
	if got := e.sessionSelection("discord:work"); got != (sessionModelSelection{}) {
		t.Fatal(got)
	}
	if got := e.ModelStatus(context.Background(), "discord:work"); got.Pending != "sol high" {
		t.Fatal(got)
	}
}

func TestQueuedModelScopeInteractiveAliasUsesExecutionKey(t *testing.T) {
	a := &stubStrictModelAgent{models: []ModelOption{{Name: "sol"}}}
	e := NewEngine("test", a, nil, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	e.queueSwitch("/workspace:discord:work", pendingModelSwitch{model: "sol", effort: "high"})
	if err := e.applyPendingSwitchOnAgent(a, "/workspace:discord:work", "discord:work"); err != nil {
		t.Fatal(err)
	}
	if got := e.sessionSettingsFor("discord:work"); got.Model != "sol" || got.ReasoningEffort != "high" {
		t.Fatal(got)
	}
}

func TestModelScopeTierAndCardsStayInChannel(t *testing.T) {
	a := &stubModelModeAgent{model: "astra", reasoningEffort: "medium"}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	e.SetModelTiers("astra", "sol", "medium", "high", 10)
	e.applyModelTier(p, &Message{SessionKey: "discord:work"}, "task")
	e.executeCardAction("/reasoning", "low", "discord:work")
	if got := e.ModelStatus(context.Background(), "discord:work"); got.Model != "sol" || got.Effort != "low" {
		t.Fatal(got)
	}
	if got := e.ModelStatus(context.Background(), "discord:drame"); got.Model != "astra" || got.Effort != "medium" {
		t.Fatal(got)
	}
}

func TestModelScopeEffortChangeRecyclesIdleProcess(t *testing.T) {
	a := &scopedStartupAgent{stubModelModeAgent{model: "astra", reasoningEffort: "medium"}}
	e := NewEngine("test", a, nil, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	key := "discord:work"
	s := e.sessions.GetOrCreateActive(key)
	s.SetAgentSessionID("native-id", "stub")
	p := &stubPlatformEngine{n: "test"}
	first := e.getOrCreateInteractiveStateWith(key, p, nil, s, e.sessions, nil, key)
	if err := e.saveSessionSelection(key, "", "high"); err != nil {
		t.Fatal(err)
	}
	next := e.getOrCreateInteractiveStateWith(key, p, nil, s, e.sessions, nil, key)
	if next == first || next.agentSession.(*scopedStartupSession).effort != "high" || s.GetAgentSessionID() != "native-id" {
		t.Fatal("effort change did not resume the conversation with new settings")
	}
}
