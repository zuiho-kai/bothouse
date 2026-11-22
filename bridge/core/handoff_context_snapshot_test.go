package core

import (
	"strings"
	"testing"
	"time"
)

type snapshotHandoffAgent struct {
	stubAgent
	usage map[string]*ContextUsage
}

func (a *snapshotHandoffAgent) ReadContextUsage(id string) *ContextUsage { return a.usage[id] }

func TestFreshOnContextSize_UsesSnapshotAndBridgeHistory(t *testing.T) {
	a := &snapshotHandoffAgent{usage: map[string]*ContextUsage{
		"below": {UsedTokens: 183399, ContextWindow: 262000},
		"full":  {UsedTokens: 183400, ContextWindow: 262000},
	}}
	e := NewEngine("snapshot", a, nil, "", LangEnglish)
	defer e.Stop()
	e.SetColdCacheFresh(true, time.Hour, 80000, 300000)
	for _, id := range []string{"below", "unknown"} {
		s := &Session{AgentSessionID: id}
		if n := e.freshOnContextSize(a, s, ""); n != "" || s.GetAgentSessionID() != id {
			t.Fatalf("below threshold or unknown context must not rotate: %s %q", id, n)
		}
	}
	s := &Session{AgentSessionID: "full", History: []HistoryEntry{
		{Role: "user", Content: "remember original-context"},
		{Role: "assistant", Content: "stored original-context"},
	}}
	if n := e.freshOnContextSize(a, s, ""); n == "" || s.GetAgentSessionID() != "" {
		t.Fatalf("authoritative snapshot did not trigger existing window cap: %q", n)
	}
	handoff := e.handoffBlock(s, "")
	if !strings.Contains(handoff, "remember original-context") || !strings.Contains(handoff, "stored original-context") || !strings.Contains(handoff, "full") {
		t.Fatalf("new context lost bridge dialogue: %s", handoff)
	}
	if len(s.GetHistory(0)) != 2 {
		t.Fatal("context rotation deleted channel history")
	}
}
