package core

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

// midTurnAgent answers SupportsMidTurnInput from a flag that flips after the gate is set up,
// like ACP, which learns it from the agent's handshake.
type midTurnAgent struct {
	workDirAgent
	can atomic.Bool
}

func (a *midTurnAgent) SupportsMidTurnInput() bool { return a.can.Load() }

// midTurnSession records which entry point the gate used.
type midTurnSession struct {
	*imgCaptureSession
	mu     sync.Mutex
	mid    []string
	midErr error
}

func (s *midTurnSession) SendMidTurn(prompt, id string, images []ImageAttachment, files []FileAttachment) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mid = append(s.mid, prompt)
	return s.midErr
}

func newMidTurnEngine(t *testing.T) (*Engine, *midTurnAgent, *stubPlatformEngine) {
	t.Helper()
	p := &stubPlatformEngine{n: "discord"}
	a := &midTurnAgent{workDirAgent: workDirAgent{resultAgent: resultAgent{session: newImgCaptureSession()}, dir: t.TempDir()}}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate(replyWhenMentioned(t).URL, 2000, "reply")
	return e, a, p
}

func TestGate_MidTurnInputAskedPerMessage(t *testing.T) {
	e, a, _ := newMidTurnEngine(t)
	if e.gate.canInject() {
		t.Fatal("agent has not advertised mid-turn input yet")
	}
	a.can.Store(true)
	if !e.gate.canInject() {
		t.Fatal("gate must see the agent's later advertisement")
	}
}

func TestGate_InjectUsesSendMidTurn(t *testing.T) {
	for _, tc := range []struct {
		name     string
		midErr   error
		injected bool
	}{
		{"steered", nil, true},
		{"refused → queued", errors.New("no prompt in flight"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, a, p := newMidTurnEngine(t)
			a.can.Store(true)
			running := &midTurnSession{imgCaptureSession: newImgCaptureSession(), midErr: tc.midErr}
			e.interactiveMu.Lock()
			e.interactiveStates["k"] = &interactiveState{agentSession: running}
			e.interactiveMu.Unlock()
			s := e.sessions.GetOrCreateActive("discord:c1")
			s.TryLock() // busy

			msg := &Message{SessionKey: "discord:c1", ChannelID: "c1", MessageID: "102", UserName: "zuiho", Content: "顺便看下这个", Mentioned: true}
			if got := e.applyGate(p, msg, s, "k"); got != tc.injected {
				t.Fatalf("applyGate handled=%v want %v", got, tc.injected)
			}
			if _, prompts := running.sent(); len(prompts) != 0 {
				t.Fatalf("the gate must not call the blocking Send: %q", prompts)
			}
			running.mu.Lock()
			defer running.mu.Unlock()
			if len(running.mid) != 1 {
				t.Fatalf("SendMidTurn calls = %d", len(running.mid))
			}
		})
	}
}
