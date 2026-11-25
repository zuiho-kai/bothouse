package core

import (
	"strings"
	"testing"
	"time"
)

// #2021: the 23:00 premarket cron wrote a full买卖 reply whose last line asked
// a teammate "三句以内，没漏洞只回 NO_REPLY". The scheduled-turn rule (#1188)
// read that word as the silent marker and swallowed the whole reply. A NO_REPLY
// inside a sentence is content; only a marker on its own line (or after a
// sentence end) silences the turn.
func TestScheduledTurnInlineNoReplyWordIsSent2021(t *testing.T) {
	const report = "【给你的挂单】\n1. 买 SOXS 20 股\n<@111> 龙娘，查一下这份有没有漏洞，三句以内，没漏洞只回 NO_REPLY"
	for _, tc := range []struct {
		name     string
		content  string
		wantSent bool
		wantText string
	}{
		{"inline word sent whole", report, true, report},
		{"bare marker line stays silent", "NO_REPLY", false, ""},
		{"plan then own-line marker stays silent", "我会先核对任务板。\nNO_REPLY", false, ""},
	} {
		for _, scheduled := range []bool{true, false} {
			name := tc.name + map[bool]string{true: "/scheduled", false: "/user"}[scheduled]
			t.Run(name, func(t *testing.T) {
				p := &stubPlatformEngine{n: "test"}
				e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
				e.SetDisplayConfig(DisplayCfg{Mode: "quiet"})
				key := "test:sched-inline-2021"
				session := e.sessions.GetOrCreateActive(key)
				agent := newControllableSession("sched-inline-2021")
				state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: scheduled}
				e.interactiveStates[key] = state
				agent.events <- Event{Type: EventResult, Content: tc.content, Done: true}
				e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
				got := strings.Join(p.getSent(), "")
				wantSent := tc.wantSent || (!scheduled && tc.name == "plan then own-line marker stays silent")
				if (strings.TrimSpace(got) != "") != wantSent {
					t.Fatalf("sent=%q want sent=%t", got, wantSent)
				}
				if tc.wantText != "" && !strings.Contains(got, tc.wantText) {
					t.Fatalf("reply altered: got %q want %q", got, tc.wantText)
				}
			})
		}
	}
}

// Segments glued around tool calls: a marker that was its own segment is
// still a marker after joining.
func TestJoinReplyPartsKeepsMarkerSegment2021(t *testing.T) {
	joined := joinReplyParts([]string{"哦 是这张", "NO_REPLY"})
	if got, ok := stripTrailingSilent(joined); !ok || got != "哦 是这张" {
		t.Fatalf("joined %q stripped to %q ok=%t", joined, got, ok)
	}
	if got := joinReplyParts([]string{"a", "b"}); got != "ab" {
		t.Fatalf("plain join changed: %q", got)
	}
}
