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

func (p *richCardInsertPlatform) Send(_ context.Context, replyCtx any, content string) error {
	p.targets = append(p.targets, replyCtx)
	p.cards = append(p.cards, content)
	return nil
}

func (p *richCardInsertPlatform) UpdateMessage(_ context.Context, handle any, content string) error {
	p.cards[handle.(int)] = content
	if p.onEdit != nil {
		p.onEdit(content)
	}
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

func TestProcessInteractiveEvents_RichCardFinalizesInPlaceWhenNoPostInsertOutput(t *testing.T) {
	p := &richCardInsertPlatform{}
	p.n = "test"
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	e.SetDisplayConfig(DisplayCfg{CardMode: "rich", ToolMessages: true, ToolMaxLen: 500, Mode: "full"})
	key := "test:room-no-post"
	session := e.sessions.GetOrCreateActive(key)
	agentSession := newControllableSession("rich-insert-no-post")
	state := &interactiveState{agentSession: agentSession, platform: p, replyCtx: "original"}
	e.interactiveStates[key] = state
	inserted := false
	p.onEdit = func(card string) {
		if inserted || !strings.Contains(card, "Already complete.") {
			return
		}
		inserted = e.injectIntoRunningTurn(key, "Late follow-up", "inserted", nil, nil)
		if !inserted {
			t.Fatal("running turn refused the insertion")
		}
	}
	agentSession.events <- Event{Type: EventText, Content: "Already complete.\n"}
	agentSession.events <- Event{Type: EventResult, Content: "Already complete.\n", Done: true}

	e.processInteractiveEvents(state, session, e.sessions, key, "original", time.Now(), nil, nil, state.replyCtx)

	if !inserted || len(p.cards) != 1 {
		t.Fatalf("inserted=%v, cards=%d, want 1 finalized card: %v", inserted, len(p.cards), p.cards)
	}
	if !strings.Contains(p.cards[0], "status=done") || strings.Contains(p.cards[0], "status=continued") {
		t.Fatalf("card should finalize as done rather than dangling continued: %s", p.cards[0])
	}
}

func TestProcessInteractiveEvents_RichCardContinuesOnTerminalOnlyPostInsertResult(t *testing.T) {
	p := &richCardInsertPlatform{}
	p.n = "test"
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	e.SetDisplayConfig(DisplayCfg{CardMode: "rich", ToolMessages: true, ToolMaxLen: 500, Mode: "full"})
	key := "test:room-terminal"
	session := e.sessions.GetOrCreateActive(key)
	agentSession := newControllableSession("rich-insert-terminal")
	state := &interactiveState{agentSession: agentSession, platform: p, replyCtx: "original"}
	e.interactiveStates[key] = state
	inserted := false
	p.onEdit = func(card string) {
		if inserted || !strings.Contains(card, "Before.") {
			return
		}
		inserted = e.injectIntoRunningTurn(key, "Add summary", "inserted", nil, nil)
		if !inserted {
			t.Fatal("running turn refused the insertion")
		}
	}
	agentSession.events <- Event{Type: EventText, Content: "Before.\n"}
	agentSession.events <- Event{Type: EventResult, Content: "Before.\nTerminal suffix.", Done: true}

	e.processInteractiveEvents(state, session, e.sessions, key, "original", time.Now(), nil, nil, state.replyCtx)

	if !inserted || len(p.cards) != 2 || p.targets[0] != "original" || p.targets[1] != "inserted" {
		t.Fatalf("inserted=%v, targets=%v, cards=%v", inserted, p.targets, p.cards)
	}
	if !strings.Contains(p.cards[0], "status=continued") || strings.Contains(p.cards[0], "Terminal suffix.") {
		t.Fatalf("old card = %s", p.cards[0])
	}
	if !strings.Contains(p.cards[1], "status=done") || !strings.Contains(p.cards[1], "Terminal suffix.") || strings.Contains(p.cards[1], "Before.") {
		t.Fatalf("new card = %s", p.cards[1])
	}
}

func TestProcessInteractiveEvents_RichCardContinuationTrimsLeadingWhitespacePrefix(t *testing.T) {
	p := &richCardInsertPlatform{}
	p.n = "test"
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	e.SetDisplayConfig(DisplayCfg{CardMode: "rich", ToolMessages: true, ToolMaxLen: 500, Mode: "full"})
	key := "test:room-indent"
	session := e.sessions.GetOrCreateActive(key)
	agentSession := newControllableSession("rich-insert-indent")
	state := &interactiveState{agentSession: agentSession, platform: p, replyCtx: "original"}
	e.interactiveStates[key] = state
	inserted := false
	p.onEdit = func(card string) {
		if inserted || !strings.Contains(card, "indented prefix") {
			return
		}
		inserted = e.injectIntoRunningTurn(key, "Continue", "inserted", nil, nil)
		if !inserted {
			t.Fatal("running turn refused the insertion")
		}
	}
	agentSession.events <- Event{Type: EventText, Content: "  indented prefix\n"}
	agentSession.events <- Event{Type: EventText, Content: "second half"}
	agentSession.events <- Event{Type: EventResult, Content: "  indented prefix\nsecond half", Done: true}

	e.processInteractiveEvents(state, session, e.sessions, key, "original", time.Now(), nil, nil, state.replyCtx)

	if len(p.cards) != 2 {
		t.Fatalf("cards=%d, want 2: %v", len(p.cards), p.cards)
	}
	if strings.Contains(p.cards[1], "indented prefix") || !strings.Contains(p.cards[1], "second half") {
		t.Fatalf("continuation card duplicated leading-whitespace prefix: %s", p.cards[1])
	}
}
