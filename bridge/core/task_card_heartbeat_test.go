package core

import (
	"testing"
	"time"
)

func newHeartbeatTestEngine(t *testing.T, key string) (*Engine, *stubCompactProgressPlatform, *controllableAgentSession, *interactiveState) {
	t.Helper()
	p := &stubCompactProgressPlatform{
		stubPlatformEngine: stubPlatformEngine{n: "discord"},
		style:              "card",
		supportPayload:     true,
	}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
	e.display.TaskCard = TaskCardCfg{OpenAfter: 40 * time.Millisecond, Heartbeat: 30 * time.Millisecond, StallAfter: 150 * time.Millisecond}
	as := newControllableSession("s-" + key)
	state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx-" + key}
	e.interactiveStates[key] = state
	return e, p, as, state
}

func heartbeatPayloads(p *stubCompactProgressPlatform) []*ProgressCardPayload {
	var out []*ProgressCardPayload
	for _, c := range append(p.getPreviewStarts(), p.getPreviewEdits()...) {
		if pl, ok := ParseProgressCardPayload(c); ok {
			out = append(out, pl)
		}
	}
	return out
}

// A tool call that runs long and emits nothing: the gateway keeps the card alive on its
// own clock (no model progress command), shows the tool in flight and marks the stall.
func TestTaskCardHeartbeat_LongSilentToolCall(t *testing.T) {
	// card clock runs 100x: 450ms real silence = 45s on the card, stall threshold 15s
	base := time.Now()
	defer func(old func() time.Time) { progressClock = old }(progressClock)
	progressClock = func() time.Time { return base.Add(100 * time.Since(base)) }
	key := "discord:silent"
	e, p, as, state := newHeartbeatTestEngine(t, key)
	e.display.TaskCard.StallAfter = 15 * time.Second
	session := e.sessions.GetOrCreateActive(key)
	go func() {
		as.events <- Event{Type: EventToolUse, ToolName: "Bash", ToolInput: "go test ./... # 10+ 分钟"}
		time.Sleep(450 * time.Millisecond) // silent: no event at all
		as.events <- Event{Type: EventToolResult, ToolName: "Bash", Content: "ok"}
		as.events <- Event{Type: EventText, Content: "测试通过"}
		as.events <- Event{Type: EventResult, Content: "测试通过", Done: true}
	}()
	e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, state.replyCtx)

	var beats, stalled int
	var final *ProgressCardPayload
	for _, pl := range heartbeatPayloads(p) {
		if pl.Heartbeat && pl.State == ProgressCardStateRunning && pl.Current == "Bash" {
			beats++ // refreshed while the tool was still in flight
			if pl.Stalled {
				stalled++
			}
		}
		final = pl
	}
	if beats < 3 {
		t.Fatalf("heartbeat refreshes = %d, want >= 3 during a silent tool call", beats)
	}
	if last := beatsMaxIdle(heartbeatPayloads(p)); last < 20 {
		t.Fatalf("max idle_sec on the card = %d, want the silence to show (>= 20s card time)", last)
	}
	if stalled == 0 {
		t.Fatal("no stall mark after the stall threshold passed")
	}
	if final == nil || final.State != ProgressCardStateCompleted || final.Stalled || final.Heartbeat {
		t.Fatalf("final card = %+v, want completed without running/stall marks", final)
	}
	line := ProgressLiveLine("zh", 754, 610, "Bash", true)
	if line != "⚠️ 疑似卡住 · 已 12分34秒 · 当前：Bash · 最近动静 10分10秒前" {
		t.Fatalf("live line = %q", line)
	}
}

// A turn with no tool call that runs past OpenAfter is a task: it gets a card.
func TestTaskCardHeartbeat_LongTurnWithoutToolsOpensCard(t *testing.T) {
	key := "discord:long"
	e, p, as, state := newHeartbeatTestEngine(t, key)
	session := e.sessions.GetOrCreateActive(key)
	go func() {
		time.Sleep(200 * time.Millisecond)
		as.events <- Event{Type: EventText, Content: "好了"}
		as.events <- Event{Type: EventResult, Content: "好了", Done: true}
	}()
	e.processInteractiveEvents(state, session, e.sessions, key, "m2", time.Now(), nil, nil, state.replyCtx)
	starts := p.getPreviewStarts()
	if len(starts) == 0 {
		t.Fatal("no card for a long turn")
	}
	if pl, ok := ParseProgressCardPayload(starts[0]); !ok || !pl.Heartbeat {
		t.Fatalf("first preview = %q, want a heartbeat card", starts[0])
	}
}

// Quick chit-chat (no tool, answered before OpenAfter) gets no card.
func TestTaskCardHeartbeat_QuickChatNoCard(t *testing.T) {
	key := "discord:chat"
	e, p, as, state := newHeartbeatTestEngine(t, key)
	e.display.TaskCard.OpenAfter = 2 * time.Second
	session := e.sessions.GetOrCreateActive(key)
	as.events <- Event{Type: EventText, Content: "你好呀"}
	as.events <- Event{Type: EventResult, Content: "你好呀", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m3", time.Now(), nil, nil, state.replyCtx)
	if n := len(heartbeatPayloads(p)); n != 0 {
		t.Fatalf("chit-chat got %d card payloads, want 0", n)
	}
}

// Tool calls make a card even when tool_messages = false (name only, no input).
func TestTaskCardHeartbeat_ToolCardWhenToolMessagesHidden(t *testing.T) {
	key := "discord:quiet"
	e, p, as, state := newHeartbeatTestEngine(t, key)
	e.display.ToolMessages = false
	e.display.TaskCard.OpenAfter = -1
	session := e.sessions.GetOrCreateActive(key)
	as.events <- Event{Type: EventToolUse, ToolName: "Read", ToolInput: "secret.txt"}
	as.events <- Event{Type: EventText, Content: "读完了"}
	as.events <- Event{Type: EventResult, Content: "读完了", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m4", time.Now(), nil, nil, state.replyCtx)
	pls := heartbeatPayloads(p)
	if len(pls) == 0 || pls[0].Steps != 1 || pls[0].Items[0].Tool != "Read" {
		t.Fatalf("payloads = %+v, want a card with the Read step", pls)
	}
}

func beatsMaxIdle(pls []*ProgressCardPayload) int {
	m := 0
	for _, pl := range pls {
		if pl.IdleSec > m {
			m = pl.IdleSec
		}
	}
	return m
}
