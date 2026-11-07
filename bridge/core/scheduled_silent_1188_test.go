package core

import (
	"testing"
	"time"
)

// #1188: 20:05 a 兜底到点 timer woke 龙娘 in the main channel and she replied
// "我会先核对 #1185 …再确认是否卡住以及由谁推进。NO_REPLY"; the plan before the
// marker reached the user. A scheduled turn ending in NO_REPLY sends nothing;
// a user turn keeps the old behaviour (text before the marker is delivered).
func TestScheduledTurnTrailingNoReplySwallowsPlan1188(t *testing.T) {
	const plan = "我会先核对 #1185 的任务板状态和工作区最近活动；如果仍在做，再确认是否卡住以及由谁推进。"
	for _, tc := range []struct {
		name      string
		scheduled bool
		wantSent  bool
	}{
		{"timer", true, false},
		{"user", false, true},
	} {
		for _, mode := range []string{"compact", "quiet"} {
			t.Run(tc.name+"/"+mode, func(t *testing.T) {
				p := &stubPlatformEngine{n: "test"}
				e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
				e.SetDisplayConfig(DisplayCfg{Mode: mode})
				key := "test:sched-silent-1188"
				session := e.sessions.GetOrCreateActive(key)
				agent := newControllableSession("sched-silent-1188")
				state := &interactiveState{agentSession: agent, platform: p, replyCtx: "ctx", turnScheduled: tc.scheduled}
				e.interactiveStates[key] = state
				agent.events <- Event{Type: EventResult, Content: plan + "NO_REPLY", Done: true}
				e.processInteractiveEvents(state, session, e.sessions, key, "m", time.Now(), nil, nil, nil)
				sent := false
				for _, s := range p.getSent() {
					if s != "" {
						sent = true
					}
				}
				if sent != tc.wantSent {
					t.Fatalf("scheduled=%t: sent=%t want %t (%q)", tc.scheduled, sent, tc.wantSent, p.getSent())
				}
			})
		}
	}
}
