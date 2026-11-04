package core

import (
	"strings"
	"testing"
	"time"
)

func TestQQ137SilentPunctuation(t *testing.T) {
	for _, marker := range []string{"NO_REPLY。", "NO_REPLY.", " NO_REPLY！", "　no_reply。　", "\u00a0NO_REPLY!?\u00a0"} {
		t.Run(marker, func(t *testing.T) {
			if !isSilentReply(marker) {
				t.Errorf("silent marker would be delivered: %q", marker)
			}
			if !couldBeSilentPrefix(marker) {
				t.Errorf("silent marker would escape streaming hold: %q", marker)
			}
			if got, ok := stripTrailingSilent("已处理\n" + marker); !ok || got != "已处理" {
				t.Errorf("trailing marker leaked: %q, stripped=%t", got, ok)
			}
		})
	}
}

func TestQQ137SilentToolBoundary(t *testing.T) {
	for _, mode := range []string{"compact", "full", "quiet"} {
		t.Run(mode, func(t *testing.T) {
			p := &stubPlatformEngine{n: "test"}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			e.SetDisplayConfig(DisplayCfg{Mode: mode, ToolMessages: mode == "full"})
			key := "test:silent-punctuation"
			session := e.sessions.GetOrCreateActive(key)
			agent := newControllableSession("silent-punctuation")
			state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx"}
			e.interactiveStates[key] = state
			agent.events <- Event{Type: EventText, Content: "　NO_REPLY。　"}
			agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "true"}
			agent.events <- Event{Type: EventResult, Content: "NO_REPLY。", Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
			for _, sent := range p.getSent() {
				if strings.Contains(sent, "NO_REPLY") {
					t.Fatalf("silent marker reached platform: %q", sent)
				}
			}
		})
	}
}
