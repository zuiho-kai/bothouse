package core

import (
	"strings"
	"testing"
)

// inject_subagent_policy = false: fresh and queued turns reach the agent
// without the per-turn delegation policy block. The default (on) is covered by
// TestCUJ_Subagents_SourcePolicySurvivesQueueAndResume.
func TestSubagentPolicySwitchOff_FreshAndQueuedTurnsCarryNoPolicy(t *testing.T) {
	_, e, a, p, s := inputFixture(t)
	e.SetSubagentPolicyEnabled(false)
	send := func(id, content string, bot bool) {
		e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: p.Name(), MessageID: id, UserID: "human", Content: content, FromBot: bot, Mentioned: true, ReplyCtx: "local"})
	}
	send("human-1", "first task", false)
	first := inputPrompt(t, a)
	if strings.Contains(first, "[Bridge delegation policy") || !strings.Contains(first, "first task") {
		t.Fatalf("fresh turn prompt = %q, want the request without the policy block", first)
	}
	send("bot-queued", "queued from a teammate", true)
	inputDone(a, "first-done")
	queued := inputPrompt(t, a)
	if strings.Contains(queued, "[Bridge delegation policy") || !strings.Contains(queued, "queued from a teammate") {
		t.Fatalf("queued turn prompt = %q, want the request without the policy block", queued)
	}
	inputDone(a, "queued-done")
	inputWait(t, func() bool { return !s.Busy() })
}

func TestSubagentPolicySwitch_DefaultOnAndToggle(t *testing.T) {
	e := NewEngine("test", &resultAgent{}, nil, "", LangEnglish)
	defer e.cancel()
	if got := e.withSubagentPolicy("hi", "human", false); !strings.HasPrefix(got, "[Bridge delegation policy") {
		t.Fatalf("default engine dropped the policy: %q", got)
	}
	e.SetSubagentPolicyEnabled(false)
	if got := e.withSubagentPolicy("hi", "human", false); got != "hi" {
		t.Fatalf("policy off: got %q, want the prompt unchanged", got)
	}
	e.SetSubagentPolicyEnabled(true)
	if got := e.withSubagentPolicy("hi", "", true); !strings.Contains(got, "This request is automated") {
		t.Fatalf("policy back on: got %q", got)
	}
}

// #597 G27: the per-turn policy said "do the task yourself … no bot handoffs", so a lead never ran the
// team rules' ws-handoff for a big task. The policy now names ws-handoff as allowed routing.
func TestSubagentPolicy_AllowsTeamWorkspaceHandoff(t *testing.T) {
	got := withSubagentPolicy("hi", "human", false)
	if !strings.Contains(got, "`ws-handoff`") || !strings.Contains(got, "not a subagent") {
		t.Fatalf("policy does not let the lead use ws-handoff: %q", got)
	}
}
