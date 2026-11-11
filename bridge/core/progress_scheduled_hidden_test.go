package core

import (
	"testing"
	"time"
)

// agentm 11-10 15:39: the lead's acceptance turn (a timer, NO_REPLY at the end) ran in an outside
// user's chat channel and showed them 「Codex·处理中 第 26 步」 for two minutes before the card was
// retracted. A scheduled turn in a chat channel opens no card and leaks no step as text; a user
// turn keeps its card.
func TestScheduledChatTurnShowsNoProgressCard(t *testing.T) {
	for _, tc := range []struct {
		name      string
		scheduled bool
		wantCard  bool
	}{
		{"timer", true, false},
		{"user", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := newCleaningCardPlatform()
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
			key := "discord:chat-accept"
			session := e.sessions.GetOrCreateActive(key)
			agent := newControllableSession("sched-card")
			state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: tc.scheduled}
			e.interactiveStates[key] = state
			agent.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "gh pr view 61"}
			agent.events <- Event{Type: EventToolResult, ToolName: "Bash", Content: "merged"}
			agent.events <- Event{Type: EventResult, Content: "NO_REPLY", Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
			card := len(p.getPreviewStarts()) > 0
			if card != tc.wantCard {
				t.Fatalf("scheduled=%t: card posted=%t want %t (starts %q)", tc.scheduled, card, tc.wantCard, p.getPreviewStarts())
			}
			if tc.scheduled {
				for _, s := range p.getSent() {
					if s != "" {
						t.Fatalf("scheduled turn leaked text: %q", p.getSent())
					}
				}
			}
		})
	}
}
