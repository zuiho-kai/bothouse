package core

import (
	"context"
	"testing"
	"time"
)

func TestResolveModelQueryRequiresExactAdvertisedID(t *testing.T) {
	options := []ModelOption{{Name: "relay/opus-5", Alias: "opus"}, {Name: "relay/opus-5-5"}, {Name: "relay/opus55"}}
	for _, option := range options {
		got, candidates := resolveModelQuery(option.Name, options)
		if got != option.Name || len(candidates) != 0 {
			t.Fatalf("exact ID changed: %q -> %q", option.Name, got)
		}
	}
	for _, query := range []string{"opus", "opus5.5", "relay/opus-55", "v4.1 falsh", "unknown/model", ""} {
		got, candidates := resolveModelQuery(query, options)
		if got != "" || len(candidates) != len(options) {
			t.Fatalf("invented a model for %q: %q", query, got)
		}
	}
}

func TestEffortVariant(t *testing.T) {
	gem := []ModelOption{{Name: "gemini-4-argon-low"}, {Name: "gemini-4-argon-medium"}, {Name: "gemini-4-argon-high"}}
	if got := effortVariant("gemini-4-argon-medium", "high", gem); got != "gemini-4-argon-high" {
		t.Fatalf("variant → %q", got)
	}
	if got := effortVariant("gemini-4-argon-medium", "xhigh", gem); got != "" {
		t.Fatalf("missing variant → %q", got)
	}
}

func TestQueueModelSwitchAppliesBeforeNextTurn(t *testing.T) {
	agent := &stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "xiao/gpt-6-astra"},
		models: []ModelOption{{Name: "xiao/gpt-6-astra"}, {Name: "xiao/gpt-6-sol"}, {Name: "xiao/gpt-6-luna"}}}
	e := NewEngine("test", agent, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	e.SetModelTiers("xiao/gpt-6-astra", "xiao/gpt-6-sol", "", "", 10)

	// The agent selects an exact advertised ID; nothing changes until the next turn.
	r := e.QueueModelSwitch(context.Background(), "discord:1", "xiao/gpt-6-sol", "", false)
	if !r.OK || r.Model != "xiao/gpt-6-sol" {
		t.Fatalf("queue = %+v", r)
	}
	if agent.model != "xiao/gpt-6-astra" {
		t.Fatal("switched mid-turn; must wait for the next turn")
	}
	if st := e.ModelStatus(context.Background(), "discord:1"); st.Pending != "xiao/gpt-6-sol" {
		t.Fatalf("pending = %q", st.Pending)
	}
	e.applyPendingSwitch("discord:1")
	if agent.model != "xiao/gpt-6-sol" {
		t.Fatalf("model after apply = %q", agent.model)
	}
	// Hand-picked model holds off automatic tiers; "auto" releases it.
	if !e.tiers.manual("discord:1", time.Now()) {
		t.Fatal("manual hold not set")
	}
	if r := e.QueueModelSwitch(context.Background(), "discord:1", "", "", true); !r.OK {
		t.Fatalf("auto = %+v", r)
	}
	e.applyPendingSwitch("discord:1")
	if e.tiers.manual("discord:1", time.Now()) {
		t.Fatal("auto did not clear the manual hold")
	}
}

func TestQueueModelSwitchAmbiguousReturnsCandidates(t *testing.T) {
	agent := &stubStrictModelAgent{models: []ModelOption{{Name: "xiao/gpt-6-astra"}, {Name: "xiao/gpt-6-sol"}}}
	e := NewEngine("test", agent, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	r := e.QueueModelSwitch(context.Background(), "k", "gpt", "", false)
	if r.OK || len(r.Candidates) != 2 {
		t.Fatalf("ambiguous = %+v", r)
	}
	if st := e.ModelStatus(context.Background(), "k"); st.Pending != "" {
		t.Fatalf("nothing should be queued: %q", st.Pending)
	}
}
