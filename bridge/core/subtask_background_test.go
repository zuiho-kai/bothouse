package core

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// movableSubTaskSession can (or cannot) move its foreground sub-agent to the background.
type movableSubTaskSession struct {
	*subTaskSession
	err   error
	moved chan string
}

func (s *movableSubTaskSession) BackgroundSubTask(id string) error {
	s.moved <- id
	return s.err
}

// 2026-11-11: a turn waited 20 minutes for a foreground sub-agent; the person's 「为什么那么久」
// was injected, acknowledged with 「↪ 已插入」 and read by nobody. An injected message now
// moves that sub-agent to the background, so the turn reads it at once.
func TestInjectMovesForegroundSubAgentToBackground(t *testing.T) {
	e := newTestEngine()
	p := &stubPlatformEngine{n: "discord"}
	as := &movableSubTaskSession{subTaskSession: newSubTaskSession(), moved: make(chan string, 1)}
	as.set(1, SubTask{ID: "bg", Background: true, Status: SubTaskRunning, StartedAt: time.Now()},
		SubTask{ID: "fg", Description: "审 PR", Status: SubTaskRunning, StartedAt: time.Now().Add(-20 * time.Minute)})
	state := &interactiveState{agentSession: as, platform: p}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = state
	e.interactiveMu.Unlock()

	if !e.injectIntoRunningTurn("k", "为什么那么久", "ctx", nil, nil) {
		t.Fatal("not injected")
	}
	select {
	case id := <-as.moved:
		if id != "fg" {
			t.Fatalf("moved %q, want the foreground sub-agent", id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("foreground sub-agent was not moved to the background")
	}
	time.Sleep(50 * time.Millisecond)
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("moved, yet a notice went out: %v", sent)
	}
}

// A backend that cannot move it says what the turn is waiting for.
func TestInjectBehindForegroundSubAgentSaysSo(t *testing.T) {
	e := newTestEngine()
	p := &stubPlatformEngine{n: "discord"}
	as := &movableSubTaskSession{subTaskSession: newSubTaskSession(), moved: make(chan string, 1), err: errors.New("old CLI")}
	as.set(1, SubTask{ID: "fg", Description: "审 PR", Status: SubTaskRunning, StartedAt: time.Now().Add(-20 * time.Minute)})
	state := &interactiveState{agentSession: as, platform: p}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = state
	e.interactiveMu.Unlock()

	if !e.injectIntoRunningTurn("k", "为什么那么久", "ctx", nil, nil) {
		t.Fatal("not injected")
	}
	deadline := time.Now().Add(2 * time.Second)
	for len(p.getSent()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	sent := p.getSent()
	if len(sent) != 1 || !strings.Contains(sent[0], "审 PR") || !strings.Contains(sent[0], "20") {
		t.Fatalf("notice: %v", sent)
	}
}

// No foreground sub-agent: nothing is moved, nothing is said.
func TestInjectWithoutForegroundSubAgent(t *testing.T) {
	e := newTestEngine()
	p := &stubPlatformEngine{n: "discord"}
	as := &movableSubTaskSession{subTaskSession: newSubTaskSession(), moved: make(chan string, 1)}
	as.set(1, SubTask{ID: "bg", Background: true, Status: SubTaskRunning, StartedAt: time.Now()})
	state := &interactiveState{agentSession: as, platform: p}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = state
	e.interactiveMu.Unlock()
	if !e.injectIntoRunningTurn("k", "hi", "ctx", nil, nil) {
		t.Fatal("not injected")
	}
	time.Sleep(50 * time.Millisecond)
	if len(as.moved) != 0 || len(p.getSent()) != 0 {
		t.Fatalf("moved %d, sent %v", len(as.moved), p.getSent())
	}
}
