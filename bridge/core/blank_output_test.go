package core

import (
	"strings"
	"testing"
	"time"
)

// A text-only platform must not receive whitespace flushed at a hidden
// thinking/tool boundary. This drives the common event loop for all agents.
func TestHiddenProgressDoesNotFlushBlankBubble(t *testing.T) {
	for _, boundary := range []EventType{EventThinking, EventToolUse} {
		t.Run(string(boundary), func(t *testing.T) {
			p := &stubPlatformEngine{n: "test"}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			t.Cleanup(func() { _ = e.Stop() })
			e.SetDisplayConfig(DisplayCfg{Mode: "compact", ThinkingMessages: false, ToolMessages: false})
			key := "test:blank-output"
			session := e.sessions.GetOrCreateActive(key)
			as := newControllableSession("blank-output")
			state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx"}
			e.interactiveStates[key] = state
			as.events <- Event{Type: EventText, Content: " \n\t"}
			as.events <- Event{Type: boundary, Content: "private thinking", ToolName: "fixture"}
			as.events <- Event{Type: EventText, Content: "visible final answer"}
			as.events <- Event{Type: EventResult, Content: "visible final answer", Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, state.replyCtx)
			sent := p.getSent()
			for _, message := range sent {
				if strings.TrimSpace(message) == "" {
					t.Errorf("blank bubble reached platform: %q", message)
				}
			}
			if !strings.Contains(strings.Join(sent, "\n"), "visible final answer") {
				t.Fatal("final answer lost")
			}
		})
	}
}
