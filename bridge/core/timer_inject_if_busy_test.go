package core

import (
	"strings"
	"testing"
)

// inject_if_busy: a timer whose session is mid-turn writes its prompt into that turn and does
// not queue a turn after it.
func TestExecuteTimerJob_InjectIfBusy_InjectsWithoutQueuing(t *testing.T) {
	p := &stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	as := newResultAgentSession("timer done")
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	defer e.cancel()

	key := "discord:channel-1:user-1"
	_, state := busySessionWithLiveState(t, e, p, key, as)

	job := &TimerJob{ID: "t1", SessionKey: key, Prompt: "report back", Description: "report", InjectIfBusy: true}
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatalf("ExecuteTimerJob() = %v, want nil (injected)", err)
	}
	state.mu.Lock()
	queued := len(state.pendingMessages)
	injected := len(state.injectedReplyCtxs)
	state.mu.Unlock()
	if queued != 0 {
		t.Fatalf("pending = %d, want 0 (injected, not queued)", queued)
	}
	if injected != 1 {
		t.Fatalf("injectedReplyCtxs = %d, want 1", injected)
	}
	if len(as.sentPrompts) != 1 || !strings.Contains(as.sentPrompts[0], "report back") {
		t.Fatalf("agent prompts = %#v, want the timer prompt sent into the running turn", as.sentPrompts)
	}
}

// When injection is refused (here: the running turn was cancelled), the job queues as before.
func TestExecuteTimerJob_InjectIfBusy_FallsBackToQueue(t *testing.T) {
	p := &stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	as := newResultAgentSession("timer done")
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	defer e.cancel()

	key := "discord:channel-1:user-1"
	session, state := busySessionWithLiveState(t, e, p, key, as)
	state.mu.Lock()
	state.turnCancelled = true
	state.mu.Unlock()

	job := &TimerJob{ID: "t2", SessionKey: key, Prompt: "check the build", Description: "build", InjectIfBusy: true}
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatalf("ExecuteTimerJob() = %v, want nil (queued)", err)
	}
	if len(as.sentPrompts) != 0 {
		t.Fatalf("agent prompts = %#v, want none before the running turn ends", as.sentPrompts)
	}
	state.mu.Lock()
	state.turnCancelled = false
	state.mu.Unlock()
	assertQueuedThenDelivered(t, e, p, session, state, key, "check the build", "timer done")
}

// When the session is idle the option changes nothing: the job runs its own turn.
func TestExecuteTimerJob_InjectIfBusy_IdleRunsOwnTurn(t *testing.T) {
	p := &stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	as := newResultAgentSession("timer done")
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	defer e.cancel()

	key := "discord:channel-1:user-1"
	job := &TimerJob{ID: "t3", SessionKey: key, Prompt: "daily check", Description: "check", InjectIfBusy: true}
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatalf("ExecuteTimerJob() = %v, want nil", err)
	}
	found := false
	for _, s := range p.getSent() {
		if s == "timer done" {
			found = true
		}
	}
	if !found {
		t.Fatalf("sent = %#v, want the job's own turn result", p.getSent())
	}
}
