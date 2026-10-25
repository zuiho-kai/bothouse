package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// relayMemoryAgent hands out one session per StartSession and records each turn's prompt and resume ID.
type relayMemoryAgent struct {
	mu       sync.Mutex
	prompts  []string
	resumes  []string
	failNext bool
}

type relayMemorySession struct {
	*controllableAgentSession
	a    *relayMemoryAgent
	fail bool
}

func (s *relayMemorySession) Send(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.a.mu.Lock()
	s.a.prompts = append(s.a.prompts, prompt)
	s.a.mu.Unlock()
	if s.fail {
		return errors.New("simulated send failure")
	}
	s.events <- Event{Type: EventResult, Content: "ok"}
	return nil
}

func (a *relayMemoryAgent) Name() string { return "relaymem" }
func (a *relayMemoryAgent) StartSession(_ context.Context, id string) (AgentSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.resumes = append(a.resumes, id)
	fail := a.failNext
	a.failNext = false
	return &relayMemorySession{controllableAgentSession: newControllableSession("relay-ctx-1"), a: a, fail: fail}, nil
}
func (a *relayMemoryAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *relayMemoryAgent) Stop() error                                             { return nil }

func (a *relayMemoryAgent) turn(i int) (prompt, resume string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.prompts[i], a.resumes[i]
}

func relayMemoryIndex(t *testing.T) string {
	idx := filepath.Join(t.TempDir(), "MEMORY.md")
	if err := os.WriteFile(idx, []byte("- [prefs](prefs/README.md) — 偏好\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return idx
}

// A task dispatched over relay: the target's first turn in a fresh relay context carries its MEMORY.md,
// and the receipt still sees the bare request (an identical retry is not run again).
func TestTaskRelayFirstTurnCarriesMemoryIndex(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	a := &relayMemoryAgent{}
	source := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangEnglish)
	source.publicProgress = p
	target := NewEngine("target", a, []Platform{newProgressPlatform()}, "", LangEnglish)
	target.SetMemoryIndex(relayMemoryIndex(t))
	rm := NewRelayManager("")
	rm.RegisterEngine("source", source)
	rm.RegisterEngine("target", target)
	p.resolveReporter = source.resolveTaskReporter
	source.SetRelayManager(rm)
	rm.Bind("discord", "room", map[string]string{"source": "Source", "target": "Target"})

	req := taskRelayRequest(id)
	if _, err := rm.Send(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	prompt, resume := a.turn(0)
	if resume != "" || !strings.Contains(prompt, memoryIndexHead) || !strings.Contains(prompt, "- [prefs](prefs/README.md)") {
		t.Fatalf("first relay turn (resume %q) has no memory index: %q", resume, prompt)
	}
	if !strings.Contains(prompt, req.Message) {
		t.Fatalf("assignment missing from prompt: %q", prompt)
	}
	// Same request again: the receipt answers it (request hash unchanged by the memory block), no new turn.
	if _, err := rm.Send(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if n := len(a.prompts); n != 1 {
		t.Fatalf("identical request re-executed: %d turns", n)
	}

	// Each dispatch has its own scope (task + request id), so a new dispatch is a new context: it gets the index too.
	req.RequestID = "dispatch-two"
	req.Message = "second assignment"
	if _, err := rm.Send(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if prompt, resume = a.turn(1); resume != "" || !strings.Contains(prompt, memoryIndexHead) {
		t.Fatalf("new dispatch (resume %q) has no memory index: %q", resume, prompt)
	}
}

// A plain relay conversation: the resumed second turn does not repeat the index.
func TestHandleRelayResumedTurnSkipsMemoryIndex(t *testing.T) {
	e := newTestEngine()
	a := &relayMemoryAgent{}
	e.agent = a
	e.SetMemoryIndex(relayMemoryIndex(t))
	for _, m := range []string{"one", "two"} {
		if _, err := e.HandleRelay(context.Background(), "source", "test:chat-1:user", m); err != nil {
			t.Fatal(err)
		}
	}
	if p, resume := a.turn(0); resume != "" || !strings.Contains(p, memoryIndexHead) {
		t.Fatalf("first relay turn (resume %q) has no memory index: %q", resume, p)
	}
	if p, resume := a.turn(1); resume != "relay-ctx-1" || strings.Contains(p, memoryIndexHead) {
		t.Fatalf("resumed relay turn (resume %q) got the memory index again: %q", resume, p)
	}
}

// A relay turn whose send failed puts the memory index back: the next turn carries it.
func TestHandleRelayFailedSendKeepsMemoryIndex(t *testing.T) {
	e := newTestEngine()
	a := &relayMemoryAgent{failNext: true}
	e.agent = a
	e.SetMemoryIndex(relayMemoryIndex(t))

	if _, err := e.HandleRelay(context.Background(), "source", "test:chat-1:user", "one"); err == nil {
		t.Fatal("failed send reported success")
	}
	if p, _ := a.turn(0); !strings.Contains(p, memoryIndexHead) {
		t.Fatalf("first turn has no memory index: %q", p)
	}
	if _, err := e.HandleRelay(context.Background(), "source", "test:chat-1:user", "two"); err != nil {
		t.Fatal(err)
	}
	if p, resume := a.turn(1); resume != "relay-ctx-1" || !strings.Contains(p, memoryIndexHead) {
		t.Fatalf("turn after a failed send (resume %q) lost the memory index: %q", resume, p)
	}
	if _, err := e.HandleRelay(context.Background(), "source", "test:chat-1:user", "three"); err != nil {
		t.Fatal(err)
	}
	if p, _ := a.turn(2); strings.Contains(p, memoryIndexHead) {
		t.Fatalf("delivered memory index sent again: %q", p)
	}
}
