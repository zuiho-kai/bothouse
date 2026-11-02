package core

import (
	"errors"
	"strings"
	"sync"
	"testing"
)

// Replays real adapter event shapes; the tool represents work already started
// by the backend. Retrying the user prompt would execute that work twice.
type boundaryCapacitySession struct {
	mu      sync.Mutex
	events  chan Event
	first   []Event
	prompts []string
}

func (s *boundaryCapacitySession) Send(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	first := len(s.prompts) == 1
	s.mu.Unlock()
	if first {
		for _, event := range s.first {
			s.events <- event
		}
		s.events <- Event{Type: EventError, Error: errors.New("Selected model is at capacity. Please try a different model.")}
	} else {
		s.events <- Event{Type: EventResult, Content: "replayed-user-work", Done: true}
	}
	return nil
}
func (s *boundaryCapacitySession) sends() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.prompts)
}
func (s *boundaryCapacitySession) RespondPermission(string, PermissionResult) error { return nil }
func (s *boundaryCapacitySession) Events() <-chan Event                             { return s.events }
func (s *boundaryCapacitySession) CurrentSessionID() string                         { return "boundary-session" }
func (s *boundaryCapacitySession) Alive() bool                                      { return true }
func (s *boundaryCapacitySession) Close() error                                     { return nil }

func TestCapacityRetry_DoesNotReplayToolBoundary(t *testing.T) {
	for _, tc := range []struct {
		name  string
		mode  string
		text  string
		tools bool
	}{
		{"visible text and tool", "compact", "first-attempt-text", true},
		{"hidden tool messages", "compact", "first-attempt-text", false},
		{"no text", "compact", "", false},
		{"quiet output", "quiet", "first-attempt-text", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			first := []Event{}
			if tc.text != "" {
				first = append(first, Event{Type: EventText, Content: tc.text})
			}
			first = append(first, Event{Type: EventToolUse, ToolName: "fixture-tool", ToolInput: "synthetic"})
			sess := &boundaryCapacitySession{events: make(chan Event, 8), first: first}
			p := &stubPlatformEngine{n: "test"}
			e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
			e.display.Mode = tc.mode
			e.display.ToolMessages = tc.tools
			t.Cleanup(func() { _ = e.Stop() })
			e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", Content: "perform user work", ReplyCtx: "ctx"})
			waitFor(t, "terminal answer or failure", func() bool {
				out := joined(p)
				return strings.Contains(out, "at capacity") || strings.Contains(out, "replayed-user-work")
			})
			if got := sess.sends(); got != 1 {
				t.Fatalf("prompt sends = %d, want 1 after tool execution; output=%q", got, joined(p))
			}
			if !strings.Contains(joined(p), "at capacity") {
				t.Fatalf("failure missing: %q", joined(p))
			}
			if e.capacityWait() != 0 {
				t.Fatal("unsafe turn queued for capacity redelivery")
			}
		})
	}
}

var _ AgentSession = (*boundaryCapacitySession)(nil)
