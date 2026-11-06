package core

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestProcessInteractiveEvents_HiddenToolsStillAdvanceProgress(t *testing.T) {
	for _, visible := range []bool{false, true} {
		t.Run(fmt.Sprint(visible), func(t *testing.T) {
			p := &stubCompactProgressPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}, style: "card", supportPayload: true}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
			e.SetDisplayConfig(DisplayCfg{ToolMessages: visible, Mode: "full"})
			key := "test:tool-steps"
			session := e.sessions.GetOrCreateActive(key)
			as := newControllableSession("steps-session")
			state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx"}
			e.interactiveStates[key] = state
			as.events <- Event{Type: EventToolUse, ToolName: "bash", ToolInput: "PRIVATE_COMMAND"}
			as.events <- Event{Type: EventToolResult, ToolName: "bash", ToolResult: "PRIVATE_OUTPUT", ToolStatus: "completed"}
			as.events <- Event{Type: EventToolResult, ToolName: "bash", ToolStatus: "completed"}
			as.events <- Event{Type: EventToolUse, ToolName: "read"}
			as.events <- Event{Type: EventToolResult, ToolName: "read", ToolStatus: "completed"}
			as.events <- Event{Type: EventResult, Content: "PUBLIC_ANSWER", Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, state.replyCtx)
			cards := append(p.getPreviewStarts(), p.getPreviewEdits()...)
			if len(cards) == 0 {
				t.Fatal("tool events produced no progress card")
			}
			payload, ok := ParseProgressCardPayload(cards[len(cards)-1])
			if !ok || payload.Steps != 2 || payload.State != ProgressCardStateCompleted {
				t.Fatalf("final card = %+v, want completed / 2 steps", payload)
			}
			if !visible && strings.Contains(strings.Join(cards, ""), "PRIVATE_") {
				t.Fatal("hidden tool details leaked into card")
			}
			if !strings.Contains(strings.Join(cards, ""), "bash") {
				t.Fatal("tool name lost")
			}
			if !strings.Contains(strings.Join(p.getSent(), ""), "PUBLIC_ANSWER") {
				t.Fatal("answer lost")
			}
		})
	}
}

func TestProgressPayload_EmptyToolEventsKeepCountAndStatus(t *testing.T) {
	items := []ProgressCardEntry{{Kind: ProgressEntryToolUse, Tool: "bash"}, {Kind: ProgressEntryToolResult, Tool: "bash", Status: "completed"}}
	// 传输层只负责别把空文本的工具事件丢掉；步数由 writer 计，不从条目数推算
	// （推算会把任务板这类 V2 payload 也变成「第 N 步」单行卡，见 TestCardView*）。
	p, ok := ParseProgressCardPayload(BuildProgressCardPayloadV2(items, false, "ACP", LangChinese, ProgressCardStateCompleted))
	if !ok || len(p.Items) != 2 || p.Items[1].Status != "completed" {
		t.Fatalf("payload = %+v", p)
	}
	platform := &stubCompactProgressPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}, style: "card", supportPayload: true}
	w := newCompactProgressWriter(context.Background(), platform, "ctx", "ACP", LangChinese, nil)
	for _, item := range items {
		w.AppendStructured(item, "")
	}
	w.Finalize(ProgressCardStateCompleted)
	p, ok = ParseProgressCardPayload(w.content)
	if !ok || p.Steps != 1 {
		t.Fatalf("empty input tools dropped: %+v", p)
	}
}
