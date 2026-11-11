package core

import (
	"strings"
	"testing"
	"time"
)

// #700: one turn, two thinking steps, no tool call. The text before the second
// thinking step goes out as a segment; the turn end must send only the text
// after it, never the whole turn again (qq-bridge.log 2026-11-11 15:35:39/40,
// out 1644204566 then out 1486142858 = both halves glued together).
func runTurnTailResend(t *testing.T, p Platform, closeOnly bool) []string {
	t.Helper()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
	key := "test:turn-tail-resend"
	session := e.sessions.GetOrCreateActive(key)
	a := &qq137FixtureSession{newControllableSession("turn-tail-resend")}
	state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	a.events <- Event{Type: EventThinking, Content: "first thought"}
	a.events <- Event{Type: EventText, Content: "我投「吃」一票，肚子不饱谈什么爱"}
	a.events <- Event{Type: EventThinking, Content: "second thought"}
	a.events <- Event{Type: EventText, Content: "这 AI 好有生存欲"}
	if closeOnly {
		close(a.events)
	} else {
		a.events <- Event{Type: EventResult, Done: true} // ACP: empty Content
	}
	e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
	return p.(interface{ getSent() []string }).getSent()
}

func assertTurnSentOnce(t *testing.T, sent []string) {
	t.Helper()
	all := strings.Join(sent, "\n")
	if n := strings.Count(all, "肚子不饱谈什么爱"); n != 1 {
		t.Fatalf("first half sent %d times, want 1: %q", n, sent)
	}
	if n := strings.Count(all, "这 AI 好有生存欲"); n != 1 {
		t.Fatalf("second half sent %d times, want 1: %q", n, sent)
	}
}

func TestTurnTailNotResentAfterThinkingSegmentQQ(t *testing.T) {
	assertTurnSentOnce(t, runTurnTailResend(t, &qq137RepeatPlatform{}, false))
}

func TestTurnTailNotResentAfterThinkingSegmentPlain(t *testing.T) {
	assertTurnSentOnce(t, runTurnTailResend(t, &stubPlatformEngine{n: "plain"}, false))
}

func TestTurnTailNotResentAfterThinkingSegmentChannelClosed(t *testing.T) {
	assertTurnSentOnce(t, runTurnTailResend(t, &qq137RepeatPlatform{}, true))
}
