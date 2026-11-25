package core

import (
	"strings"
	"testing"
)

type nativePromptAgent struct{ Agent }

func (nativePromptAgent) HasSystemPromptSupport() bool { return true }

// Every CLI gets the same bridge instructions (sending files back, `bothouse about`…): native agents
// in the system prompt, the others once per agent context with the turn rules, even when team rules
// are off (#1994: a Gemini role gave only a local path because the file-sending rule was Claude-only).
func TestAboutHintReachesEveryAgentOnce(t *testing.T) {
	if !strings.Contains(AgentSystemPrompt(), aboutHint) || !strings.HasPrefix(AgentSystemPrompt(), bridgeInstructions) {
		t.Fatal("system prompt lacks the shared bridge instructions")
	}
	if !strings.Contains(bridgeInstructions, "bothouse send --file") || !strings.Contains(bridgeInstructions, aboutHint) {
		t.Fatal("shared instructions lack the file-sending rule or the about hint")
	}
	_, e, a, _, s := inputFixture(t)
	rules := teamModeRulesFor(DefaultDispatchMode)

	if got := e.contextRules(rules, s, nativePromptAgent{a}); got != rules {
		t.Fatalf("native agent got the hint twice (system prompt + turn): %q", got[max(0, len(got)-200):])
	}
	s.ResetTurnCtx()
	if got := e.contextRules(rules, s, a); got != rules+"\n\n"+bridgeInstructionsBlock+"\n" {
		t.Fatalf("non-native agent missing bridge instructions: %q", got[max(0, len(got)-200):])
	}
	if got := e.contextRules(rules, s, a); got != "" {
		t.Fatal("hint resent within the same agent context")
	}

	s.ResetTurnCtx()
	e.SetTeamModeRulesEnabled(false)
	if got := e.contextRules(rules, s, a); got != bridgeInstructionsBlock+"\n" {
		t.Fatalf("rules off: want hint only, got %q", got)
	}
	s.ResetTurnCtx()
	if got := e.contextRules(rules, s, nativePromptAgent{a}); got != "" {
		t.Fatalf("rules off, native: want nothing, got %q", got)
	}
}

// A handoff drops the shared instructions from old user turns and keeps the user's words.
func TestBridgeInstructionsStrippedFromHandoff(t *testing.T) {
	turn := "rules\n\n" + bridgeInstructionsBlock + "\n\n用户的话"
	if got := stripStaleBlocks(turn); strings.Contains(got, "bothouse send --file") || !strings.Contains(got, "用户的话") {
		t.Fatalf("got %q", got[:min(len(got), 200)])
	}
}
