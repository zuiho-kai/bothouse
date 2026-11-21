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
