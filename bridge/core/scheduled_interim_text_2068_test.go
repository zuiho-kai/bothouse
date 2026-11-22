package core

import (
	"strings"
	"testing"
	"time"
)

// timerInterimPlatform reconstructs a reply context like the real platforms a
// timer job runs on, and can stream a live preview — the two surfaces the
// leaked narration used (#2068).
type timerInterimPlatform struct {
	stubCompactProgressPlatform
}

func (p *timerInterimPlatform) ReconstructReplyCtx(string) (any, error) { return "rctx", nil }

func newTimerInterimPlatform() *timerInterimPlatform {
	return &timerInterimPlatform{stubCompactProgressPlatform{
		stubPlatformEngine: stubPlatformEngine{n: "discord"},
		style:              "card",
		supportPayload:     true,
	}}
}

// #2068: on 11-22 the lead's scheduled acceptance turn leaked the narration it
// wrote between tool calls ("Need the report. Find it.", "Meanwhile check the
// PR directly.") into the chat channel as standalone messages — three posts in
// one round whose final reply was NO_REPLY. A scheduled turn in a chat channel
// shows only its final reply: no live preview and no segment at a
// tool/thinking/permission boundary, with the preview on or off. A user turn
// is unchanged.
func TestScheduledChatTurnLeaksNoInterimText(t *testing.T) {
	for _, previewOn := range []bool{true, false} {
		name := "preview-off"
		if previewOn {
			name = "preview-on"
		}
		t.Run(name, func(t *testing.T) {
			p := newCleaningCardPlatform()
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			e.SetDisplayConfig(DisplayCfg{Mode: "compact", ToolMessages: false})
			if !previewOn {
				e.SetStreamPreviewCfg(StreamPreviewCfg{Enabled: false})
			}
			key := "discord:chat-accept"
			session := e.sessions.GetOrCreateActive(key)
			agent := newControllableSession("sched-interim")
			state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: true}
			e.interactiveStates[key] = state
			agent.events <- Event{Type: EventText, Content: "Need the report. Find it."}
			agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "gh pr view 61"}
			agent.events <- Event{Type: EventText, Content: "Meanwhile check the PR directly."}
			agent.events <- Event{Type: EventToolResult, ToolName: "Bash", Content: "merged"}
			agent.events <- Event{Type: EventResult, Content: "NO_REPLY", Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
			for _, s := range p.getSent() {
				if s != "" {
					t.Fatalf("scheduled turn leaked a message: %q", p.getSent())
				}
			}
			if starts := p.getPreviewStarts(); len(starts) > 0 {
				t.Fatalf("scheduled turn opened a live preview: %q", starts)
			}
			if edits := p.getPreviewEdits(); len(edits) > 0 {
				t.Fatalf("scheduled turn committed a preview segment: %q", edits)
			}
		})
	}
}

// The same scheduled turn keeps its final reply: the channel sees it, and only
// it — the interim narration stays out.
func TestScheduledChatTurnStillSendsFinalReply(t *testing.T) {
	p := newCleaningCardPlatform()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact", ToolMessages: false})
	key := "discord:chat-accept"
	session := e.sessions.GetOrCreateActive(key)
	agent := newControllableSession("sched-final")
	state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: true}
	e.interactiveStates[key] = state
	agent.events <- Event{Type: EventText, Content: "正在验收"}
	agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "gh pr view 61"}
	agent.events <- Event{Type: EventResult, Content: "验收通过，可以合并", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	sent := p.getSent()
	if len(sent) != 1 || !strings.Contains(sent[0], "验收通过") {
		t.Fatalf("sent = %q, want exactly the final reply", sent)
	}
	if strings.Contains(sent[0], "正在验收") {
		t.Fatalf("final reply carried interim narration: %q", sent[0])
	}
	if starts := p.getPreviewStarts(); len(starts) > 0 {
		t.Fatalf("scheduled turn opened a live preview: %q", starts)
	}
}

// A user turn in the same channel is unchanged: narration between tool calls
// still reaches the chat as its own message.
func TestUserChatTurnStillSendsInterimText(t *testing.T) {
	p := newCleaningCardPlatform()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact", ToolMessages: false})
	e.SetStreamPreviewCfg(StreamPreviewCfg{Enabled: false})
	key := "discord:chat-accept"
	session := e.sessions.GetOrCreateActive(key)
	agent := newControllableSession("user-interim")
	state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: false}
	e.interactiveStates[key] = state
	agent.events <- Event{Type: EventText, Content: "Need the report. Find it."}
	agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "gh pr view 61"}
	agent.events <- Event{Type: EventResult, Content: "done", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	if !strings.Contains(strings.Join(p.getSent(), "\n"), "Need the report. Find it.") {
		t.Fatalf("user turn lost its interim segment: %q", p.getSent())
	}
}

// A scheduled message picked up from the queue rebuilds its output writers;
// they must come back hidden too — the rebuild used to drop hideForScheduled
// and re-enable the live preview.
func TestScheduledQueuedChatTurnRehidesOutput(t *testing.T) {
	p := newCleaningCardPlatform()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact", ToolMessages: false})
	key := "discord:chat-accept"
	session := e.sessions.GetOrCreateActive(key)
	agent := newControllableSession("sched-queued")
	state := &interactiveState{
		agentSession: agent, platform: p, replyCtx: "ctx",
		pendingMessages: []queuedMessage{{platform: p, replyCtx: "ctx", userID: "timer", content: "验收轮", msgSessionKey: key}},
	}
	e.interactiveStates[key] = state
	agent.events <- Event{Type: EventResult, Content: "first done", Done: true}
	// The chained pickup drains the events channel first, so the second turn's
	// events go in only after the new turn has started.
	go func() {
		time.Sleep(100 * time.Millisecond)
		agent.events <- Event{Type: EventText, Content: "checking the queue"}
		agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "board list"}
		agent.events <- Event{Type: EventResult, Content: "NO_REPLY", Done: true}
	}()
	done := make(chan struct{})
	go func() {
		defer close(done)
		e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("event loop did not end after the queued scheduled turn")
	}
	sent := p.getSent()
	if len(sent) != 1 || !strings.Contains(sent[0], "first done") {
		t.Fatalf("sent = %q, want only the first turn's reply", sent)
	}
	if starts := p.getPreviewStarts(); len(starts) > 0 {
		t.Fatalf("queued scheduled turn opened a live preview: %q", starts)
	}
	if edits := p.getPreviewEdits(); len(edits) > 0 {
		t.Fatalf("queued scheduled turn committed a preview segment: %q", edits)
	}
}

// timerInterimSession signals every prompt Send so a test can feed events only
// once the turn started reading (anything buffered earlier counts as stale and
// gets drained).
type timerInterimSession struct {
	events chan Event
	sent   chan struct{}
}

func newTimerInterimSession() *timerInterimSession {
	return &timerInterimSession{events: make(chan Event, 8), sent: make(chan struct{}, 4)}
}

func (s *timerInterimSession) Send(_ string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.sent <- struct{}{}
	return nil
}
func (s *timerInterimSession) RespondPermission(_ string, _ PermissionResult) error { return nil }
func (s *timerInterimSession) Events() <-chan Event                                 { return s.events }
func (s *timerInterimSession) CurrentSessionID() string                             { return "timer-interim" }
func (s *timerInterimSession) Alive() bool                                          { return true }
func (s *timerInterimSession) Close() error                                         { return nil }

// The same round driven through the real timer-job entry (ExecuteTimerJob, as
// the scheduler calls it): an acceptance check job posts no start notice, and
// with only a NO_REPLY the channel sees nothing at all; a turn that does find
// something posts that reply, and only that reply.
func TestTimerJobChatTurnLeaksNoInterimText(t *testing.T) {
	p := newTimerInterimPlatform()
	agent := newTimerInterimSession()
	e := NewEngine("test", &resultAgent{session: agent}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact", ToolMessages: false})
	defer e.cancel()
	job := &TimerJob{ID: "j1", SessionKey: "discord:chat-accept", Prompt: "验收 #61", Description: "验收轮"}

	// Round 1: narration between tool calls, final reply NO_REPLY — nothing out.
	go func() {
		<-agent.sent
		agent.events <- Event{Type: EventText, Content: "Need the report. Find it."}
		agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "gh pr view 61"}
		agent.events <- Event{Type: EventText, Content: "Meanwhile check the PR directly."}
		agent.events <- Event{Type: EventResult, Content: "NO_REPLY", Done: true}
	}()
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatalf("ExecuteTimerJob: %v", err)
	}
	for _, s := range p.getSent() {
		if s != "" {
			t.Fatalf("timer check turn leaked a message: %q", p.getSent())
		}
	}
	if starts := p.getPreviewStarts(); len(starts) > 0 {
		t.Fatalf("timer turn opened a live preview: %q", starts)
	}
	if edits := p.getPreviewEdits(); len(edits) > 0 {
		t.Fatalf("timer turn committed a preview segment: %q", edits)
	}

	// Round 2: a real finding — the channel sees it, still nothing interim.
	go func() {
		<-agent.sent
		agent.events <- Event{Type: EventText, Content: "looking at the diff"}
		agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "gh pr diff 61"}
		agent.events <- Event{Type: EventResult, Content: "发现问题：PR 缺回归测试", Done: true}
	}()
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatalf("ExecuteTimerJob round 2: %v", err)
	}
	sent := p.getSent()
	if len(sent) != 1 || !strings.Contains(sent[0], "发现问题") {
		t.Fatalf("sent = %q, want only the timer turn's finding", sent)
	}
}
