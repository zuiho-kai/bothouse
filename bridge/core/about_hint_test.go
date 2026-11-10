package core

import (
	"strings"
	"testing"
)

type nativePromptAgent struct{ Agent }

func (nativePromptAgent) HasSystemPromptSupport() bool { return true }

// Every role learns to run `bothouse about`: native agents in the system prompt, the others once
// per agent context with the turn rules, even when team rules are off.
func TestAboutHintReachesEveryAgentOnce(t *testing.T) {
	if !strings.Contains(AgentSystemPrompt(), aboutHint) {
		t.Fatal("system prompt lacks the about hint")
	}
	_, e, a, _, s := inputFixture(t)
	rules := teamModeRulesFor(DefaultDispatchMode)

	if got := e.contextRules(rules, s, nativePromptAgent{a}); got != rules {
		t.Fatalf("native agent got the hint twice (system prompt + turn): %q", got[max(0, len(got)-200):])
	}
	s.ResetTurnCtx()
	if got := e.contextRules(rules, s, a); got != rules+"\n"+aboutHint {
		t.Fatalf("non-native agent missing hint: %q", got[max(0, len(got)-200):])
	}
	if got := e.contextRules(rules, s, a); got != "" {
		t.Fatal("hint resent within the same agent context")
	}

	s.ResetTurnCtx()
	e.SetTeamModeRulesEnabled(false)
	if got := e.contextRules(rules, s, a); got != aboutHint {
		t.Fatalf("rules off: want hint only, got %q", got)
	}
	s.ResetTurnCtx()
	if got := e.contextRules(rules, s, nativePromptAgent{a}); got != "" {
		t.Fatalf("rules off, native: want nothing, got %q", got)
	}
}
