package core

import (
	"context"
	"strings"
	"testing"
	"time"
)

type richCardInsertPlatform struct {
	stubCompactProgressPlatform
	targets []any
	cards   []string
	onEdit  func(string)
}

func (p *richCardInsertPlatform) RichCardContinuationReply(_, inserted any) (any, bool) {
	return inserted, inserted != nil
}

func (p *richCardInsertPlatform) SendPreviewStart(_ context.Context, replyCtx any, content string) (any, error) {
	p.targets = append(p.targets, replyCtx)
	p.cards = append(p.cards, content)
	return len(p.cards) - 1, nil
}

func (p *richCardInsertPlatform) UpdateMessage(_ context.Context, handle any, content string) error {
	p.cards[handle.(int)] = content
	p.onEdit(content)
	return nil
}

func TestProcessInteractiveEvents_RichCardContinuesBelowInsertedMessage(t *testing.T) {
	p := &richCardInsertPlatform{}
	p.n = "test"
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	e.SetDisplayConfig(DisplayCfg{CardMode: "rich", ToolMessages: true, ToolMaxLen: 500, Mode: "full"})
	key := "test:room"
	session := e.sessions.GetOrCreateActive(key)
	agentSession := newControllableSession("rich-insert")
	state := &interactiveState{agentSession: agentSession, platform: p, replyCtx: "original"}
	e.interactiveStates[key] = state
	inserted := false
	p.onEdit = func(card string) {
		if inserted || !strings.Contains(card, "Before the insertion.") {
			return
		}
		inserted = e.injectIntoRunningTurn(key, "Please add one detail", "inserted", nil, nil)
		if !inserted {
			t.Fatal("running turn refused the insertion")
		}
	}
	agentSession.events <- Event{Type: EventToolUse, ToolName: "Read", ToolInput: "report.txt"}
	agentSession.events <- Event{Type: EventText, Content: "Before the insertion.\n"}
	agentSession.events <- Event{Type: EventToolResult, ToolName: "Read", ToolResult: "Report contents"}
	agentSession.events <- Event{Type: EventText, Content: "After the insertion."}
	agentSession.events <- Event{Type: EventResult, Content: "Before the insertion.\nAfter the insertion.", Done: true}

	e.processInteractiveEvents(state, session, e.sessions, key, "original", time.Now(), nil, nil, state.replyCtx)

	if !inserted || len(p.cards) != 2 || p.targets[0] != "original" || p.targets[1] != "inserted" {
		t.Fatalf("inserted=%v, card targets=%v, want original then inserted", inserted, p.targets)
	}
	if old := p.cards[0]; !strings.Contains(old, "Before the insertion.") || strings.Contains(old, "Report contents") || strings.Contains(old, "After the insertion.") || !strings.Contains(old, "status=continued") || !strings.Contains(old, "streaming=false") {
		t.Fatalf("old card was changed after the insertion: %s", old)
	}
	if next := p.cards[1]; !strings.Contains(next, "After the insertion.") || strings.Contains(next, "Before the insertion.") || !strings.Contains(next, "Summary:report.txt Result:Report contents") {
		t.Fatalf("continuation lost the tool call/result or repeated earlier text: %s", next)
	}
}
