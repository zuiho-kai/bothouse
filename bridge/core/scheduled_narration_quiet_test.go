package core

import (
	"strings"
	"testing"
	"time"
)

// #953 (11-22 01:57): the lead's acceptance timer turn wrote "Need the report. Find it." and
// "Meanwhile check the PR directly." between tool calls and ended with NO_REPLY, yet both lines
// reached the chat as messages: the progress card was hidden for the scheduled turn, but the
// narration between tool calls still went out as preview/segment messages. A scheduled chat turn
// shows only its final reply; a user turn keeps its narration.
func TestScheduledChatTurnNarrationStaysOutOfChat(t *testing.T) {
	const narration1, narration2 = "Need the report. Find it.", "Meanwhile check the PR directly."
	for _, tc := range []struct {
		name          string
		scheduled     bool
		toolMessages  bool
		final         string
		wantNarration bool
		wantFinal     bool
	}{
		{"timer NO_REPLY", true, false, "NO_REPLY", false, false},
		{"timer NO_REPLY tool lines on", true, true, "NO_REPLY", false, false},
		{"timer final reply", true, false, "验收完了，已合并。", false, true},
		{"user turn", false, false, "验收完了，已合并。", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := newCleaningCardPlatform()
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
			e.display.ToolMessages = tc.toolMessages
			key := "discord:chat-narration"
			session := e.sessions.GetOrCreateActive(key)
			agent := newControllableSession("sched-narration")
			state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: tc.scheduled}
			e.interactiveStates[key] = state
			agent.events <- Event{Type: EventText, Content: narration1}
			agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "ls notes"}
			agent.events <- Event{Type: EventToolResult, ToolName: "Bash", Content: "ok"}
			agent.events <- Event{Type: EventText, Content: narration2}
			agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "gh pr view 2067"}
			agent.events <- Event{Type: EventToolResult, ToolName: "Bash", Content: "merged"}
			agent.events <- Event{Type: EventText, Content: tc.final}
			agent.events <- Event{Type: EventResult, Content: tc.final, Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)

			out := strings.Join(append(append(p.getSent(), p.getPreviewStarts()...), p.getPreviewEdits()...), "\n")
			if got := strings.Contains(out, narration1) || strings.Contains(out, narration2); got != tc.wantNarration {
				t.Fatalf("narration in chat = %t, want %t; out:\n%s", got, tc.wantNarration, out)
			}
			if got := strings.Contains(out, "验收完了"); got != tc.wantFinal {
				t.Fatalf("final reply in chat = %t, want %t; out:\n%s", got, tc.wantFinal, out)
			}
		})
	}
}

// A streaming card is a live preview surface too: a quiet scheduled turn opens
// none; a user turn on the same platform still gets its card.
func TestScheduledChatTurnOpensNoStreamCard(t *testing.T) {
	for _, tc := range []struct {
		name      string
		scheduled bool
		wantCard  bool
	}{
		{"timer turn", true, false},
		{"user turn", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &stubStreamingCardPlatform{stubPlatformEngine: stubPlatformEngine{n: "dingtalk"}}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			key := "dingtalk:chat-quiet"
			session := e.sessions.GetOrCreateActive(key)
			agent := newControllableSession("sched-card")
			state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: tc.scheduled}
			e.interactiveStates[key] = state
			agent.events <- Event{Type: EventText, Content: "Need the report. Find it."}
			agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "ls"}
			agent.events <- Event{Type: EventResult, Content: "done", Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
			if p.cardCreated != tc.wantCard {
				t.Fatalf("streaming card created = %t, want %t", p.cardCreated, tc.wantCard)
			}
		})
	}
}

// A quiet scheduled turn sends no instant "starting" reply; a user turn keeps it.
func TestScheduledChatTurnSkipsInstantReply(t *testing.T) {
	for _, tc := range []struct {
		name      string
		scheduled bool
		wantReply bool
	}{
		{"timer turn", true, false},
		{"user turn", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := newCleaningCardPlatform()
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			e.SetInstantReply(InstantReplyCfg{Enabled: true, Content: "starting"})
			key := "discord:chat-instant"
			session := e.sessions.GetOrCreateActive(key)
			agent := newControllableSession("sched-instant")
			state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: tc.scheduled}
			e.interactiveStates[key] = state
			agent.events <- Event{Type: EventResult, Content: "done", Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
			got := strings.Contains(strings.Join(p.getSent(), "\n"), "starting")
			if got != tc.wantReply {
				t.Fatalf("instant reply sent = %t, want %t; sent: %q", got, tc.wantReply, p.getSent())
			}
		})
	}
}

// A scheduled message picked up from the queue rebuilds its output writers;
// they must come back hidden too — the rebuild used to drop hideForScheduled
// and re-enable the live preview (#2068).
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
// something posts that reply, and only that reply (#2068).
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
