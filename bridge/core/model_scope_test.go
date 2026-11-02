package core

import (
	"context"
	"path/filepath"
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
