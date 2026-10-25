package core

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

// #597 G25: the ws-handoff wake-up (timer --handoff) is handed-over work, not a
// routine timer, so its turn opens the automatic progress card in the workspace.
func TestAutoProgress_HandoffTimerTurnGetsAutoCard(t *testing.T) {
	if got := timerTurnUser(&TimerJob{Handoff: true}); got != "handoff" {
		t.Fatalf("handoff timer user = %q", got)
	}
	if got := timerTurnUser(&TimerJob{}); got != "timer" {
		t.Fatalf("plain timer user = %q", got)
	}
	if scheduledTurnUser(timerTurnUser(&TimerJob{Handoff: true})) {
		t.Fatal("handoff wake-up treated as a routine scheduled turn")
	}
	platform := newProgressPlatform()
	e := NewEngine("fish", &stubAgent{}, []Platform{platform}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	markWorkspace(t, e, "room:ws")
	st := &interactiveState{platform: platform, turnDesc: "⏰ 工作区接手",
		turnScheduled: scheduledTurnUser(timerTurnUser(&TimerJob{Handoff: true}))}
	e.withPublicProgress("prompt", st, "room:ws", false, false)
	e.notePublicProgressTool(st, "ls")
	e.notePublicProgressTool(st, "cat")
	if n := len(e.publicProgress.Tasks("room:ws", 10)); n != 1 {
		t.Fatalf("handoff wake-up opened %d cards, want 1", n)
	}
	e.finishPublicProgress(st, "result")
}

func TestTimerAddRequest_HandoffReachesJob(t *testing.T) {
	var req TimerAddRequest
	if err := json.Unmarshal([]byte(`{"session_key":"discord:1","delay":"1m","prompt":"p","handoff":true}`), &req); err != nil {
		t.Fatal(err)
	}
	if !req.Handoff {
		t.Fatal("handoff not decoded")
	}
}

// toolResultSession answers every Send with two tool calls and a result, enough
// for the automatic card to open (autoProgressTools).
type toolResultSession struct {
	*resultAgentSession
	mu     sync.Mutex
	events chan Event
}

func newToolResultSession(result string) *toolResultSession {
	return &toolResultSession{resultAgentSession: newResultAgentSession(result), events: make(chan Event, 16)}
}

func (s *toolResultSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.sentPrompts = append(s.sentPrompts, prompt)
	s.mu.Unlock()
	s.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "ls"}
	s.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "cat notes/b.md"}
	s.events <- Event{Type: EventResult, Content: s.result, Done: true}
	return nil
}

func (s *toolResultSession) Events() <-chan Event { return s.events }

// #597 G25 review 1: a handoff wake-up that fires while the workspace is busy with A
// must not be folded into A's turn (that path never arms a card, so B's progress
// would land on A's card or on none). B waits in the queue and, when its turn
// starts, opens its own card — even if the job asks for inject_if_busy.
func TestExecuteTimerJob_HandoffBusyQueuesAndOpensOwnCard(t *testing.T) {
	p := newProgressPlatform()
	p.n = "room" // markWorkspace files workspaces under the "room" platform
	as := newToolResultSession("B done")
	e := NewEngine("fish", midTurnResultAgent{&resultAgent{session: as}}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	key := "room:ws1"
	markWorkspace(t, e, key)
	session, state := busySessionWithLiveState(t, e, p, key, as)

	job := &TimerJob{ID: "h1", SessionKey: key, Prompt: "接手交接 B", Description: "工作区接手 B", Handoff: true, InjectIfBusy: true}
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatalf("ExecuteTimerJob() = %v, want nil (queued)", err)
	}
	state.mu.Lock()
	queued, injected := len(state.pendingMessages), len(state.injectedReplyCtxs)
	state.mu.Unlock()
	if queued != 1 || injected != 0 {
		t.Fatalf("pending = %d, injected = %d; want B queued behind A, not injected", queued, injected)
	}
	if n := len(e.publicProgress.Tasks(key, 10)); n != 0 {
		t.Fatalf("cards before B's turn = %d, want 0", n)
	}

	// A ends: the drain loop starts B's own turn.
	if !e.drainPendingMessages(state, session, e.sessions, key) {
		t.Fatal("drainPendingMessages did not unlock the session")
	}
	tasks := e.publicProgress.Tasks(key, 10)
	if len(tasks) != 1 {
		t.Fatalf("cards after B's turn = %d, want B's own card", len(tasks))
	}
	if !strings.Contains(tasks[0].Title, "工作区接手 B") {
		t.Fatalf("card title = %q, want B's", tasks[0].Title)
	}
}
