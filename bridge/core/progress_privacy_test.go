package core

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Exercise the real event loop: failed card delivery must not change the
// visibility of tool input/output by handing it back to the chat fallback.
type failingToolProgressPlatform struct {
	stubCompactProgressPlatform
	failStart bool
}

func (p *failingToolProgressPlatform) SendPreviewStart(ctx context.Context, r any, content string) (any, error) {
	if p.failStart {
		return nil, fmt.Errorf("fixture EOF")
	}
	return p.stubCompactProgressPlatform.SendPreviewStart(ctx, r, content)
}

func (p *failingToolProgressPlatform) UpdateMessage(context.Context, any, string) error {
	return fmt.Errorf("fixture unexpected EOF")
}

func TestCardToolFallbackBoundary(t *testing.T) {
	for _, style := range []string{progressStyleCard, progressStyleCompact, progressStyleLegacy} {
		for _, failed := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/failed=%v", style, failed), func(t *testing.T) {
				// No updater: covers a disabled writer as well as an already failed one.
				p := &stubPlatformNoProgress{}
				w := newCompactProgressWriter(context.Background(), p, progressHintReplyCtx{style: style}, "test", LangEnglish, nil)
				w.failed = failed
				for _, kind := range []ProgressCardEntryKind{ProgressEntryThinking, ProgressEntryToolUse, ProgressEntryToolResult, ProgressEntryInfo, ProgressEntryError} {
					got := w.AppendStructured(ProgressCardEntry{Kind: kind, Tool: "bash", Text: "private payload"}, "raw fallback")
					want := style == progressStyleCard && (kind == ProgressEntryThinking || kind == ProgressEntryToolUse || kind == ProgressEntryToolResult)
					if got != want {
						t.Errorf("kind %s consumed=%v, want %v", kind, got, want)
					}
				}
			})
		}
	}
}

func TestProcessInteractiveEvents_CardFailureDoesNotPublishToolDetails(t *testing.T) {
	for _, failStart := range []bool{true, false} {
		for _, resultInContent := range []bool{true, false} {
			t.Run(fmt.Sprintf("start=%v/content=%v", failStart, resultInContent), func(t *testing.T) {
				p := &failingToolProgressPlatform{stubCompactProgressPlatform: stubCompactProgressPlatform{
					stubPlatformEngine: stubPlatformEngine{n: "test"}, style: "card", supportPayload: true,
				}, failStart: failStart}
				e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
				e.SetDisplayConfig(DisplayCfg{ToolMessages: true, Mode: "full"})
				key := "test:tool-privacy"
				session := e.sessions.GetOrCreateActive(key)
				as := newControllableSession("privacy-session")
				state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx"}
				e.interactiveStates[key] = state
				as.events <- Event{Type: EventToolUse, ToolName: "bash", ToolInput: "python3 - <<'PY'\nPRIVATE_COMMAND_ONE\nPY"}
				result := Event{Type: EventToolResult, ToolName: "bash"}
				if resultInContent {
					result.Content = "PRIVATE_FILE_OUTPUT"
				} else {
					result.ToolResult = "PRIVATE_FILE_OUTPUT"
				}
				as.events <- result
				as.events <- Event{Type: EventToolUse, ToolName: "bash", ToolInput: "PRIVATE_COMMAND_TWO"}
				as.events <- Event{Type: EventToolResult, ToolName: "bash", ToolResult: "PRIVATE_FAILURE_OUTPUT", ToolStatus: "failed"}
				as.events <- Event{Type: EventResult, Content: "PUBLIC_FINAL_ANSWER", Done: true}
				e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, state.replyCtx)
				sent := strings.Join(p.getSent(), "\n")
				for _, private := range []string{"PRIVATE_COMMAND_ONE", "PRIVATE_COMMAND_TWO", "PRIVATE_FILE_OUTPUT", "PRIVATE_FAILURE_OUTPUT"} {
					if strings.Contains(sent, private) {
						t.Errorf("raw tool detail escaped into standalone chat: %s", private)
					}
				}
				if !strings.Contains(sent, "PUBLIC_FINAL_ANSWER") {
					t.Fatalf("public answer lost: %q", sent)
				}
			})
		}
	}
}

// Reproduces the 2026-11-23 05:04 Discord incident: once the card's
// UpdateMessage hits an unexpected EOF, subsequent EventThinking events must
// stay suppressed instead of falling back to standalone 💭 chat messages.
func TestProcessInteractiveEvents_CardFailureDoesNotPublishThinking(t *testing.T) {
	for _, failStart := range []bool{true, false} {
		t.Run(fmt.Sprintf("start=%v", failStart), func(t *testing.T) {
			p := &failingToolProgressPlatform{stubCompactProgressPlatform: stubCompactProgressPlatform{
				stubPlatformEngine: stubPlatformEngine{n: "discord"}, style: "card", supportPayload: true,
			}, failStart: failStart}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
			e.SetDisplayConfig(DisplayCfg{ThinkingMessages: true, ToolMessages: false, Mode: "full"})
			key := "discord:thinking-privacy"
			session := e.sessions.GetOrCreateActive(key)
			as := newControllableSession("thinking-privacy-session")
			state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx"}
			e.interactiveStates[key] = state
			as.events <- Event{Type: EventThinking, Content: "PRIVATE_THOUGHT_ONE"}
			as.events <- Event{Type: EventToolUse, ToolName: "bash", ToolInput: "ls"}
			as.events <- Event{Type: EventThinking, Content: "PRIVATE_THOUGHT_TWO"}
			as.events <- Event{Type: EventText, Content: "PUBLIC_FINAL_ANSWER"}
			as.events <- Event{Type: EventResult, Done: true}
			e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, state.replyCtx)
			sent := strings.Join(p.getSent(), "\n")
			for _, leak := range []string{"💭", "PRIVATE_THOUGHT_ONE", "PRIVATE_THOUGHT_TWO"} {
				if strings.Contains(sent, leak) {
					t.Errorf("thinking leaked into standalone chat: %s (sent=%q)", leak, sent)
				}
			}
			if !strings.Contains(sent, "PUBLIC_FINAL_ANSWER") {
				t.Fatalf("public answer lost: sent=%q", sent)
			}
		})
	}
}

// cardCleanerPlatform models Discord's progress_style=card + PreviewCleaner
// contract, tracking every message still live in the channel (non-deleted
// previews + standalone sends) separately from progress card payloads.
type cardCleanerPlatform struct {
	stubCompactProgressPlatform
	failCardUpdate bool
	nextID         int
	livePreviews   map[string]string
}

func (p *cardCleanerPlatform) SendPreviewStart(_ context.Context, _ any, content string) (any, error) {
	p.previewMu.Lock()
	defer p.previewMu.Unlock()
	p.previewStarts = append(p.previewStarts, content)
	p.nextID++
	id := fmt.Sprintf("msg-%d", p.nextID)
	if p.livePreviews == nil {
		p.livePreviews = make(map[string]string)
	}
	p.livePreviews[id] = content
	return id, nil
}

func (p *cardCleanerPlatform) UpdateMessage(_ context.Context, handle any, content string) error {
	p.previewMu.Lock()
	defer p.previewMu.Unlock()
	if p.failCardUpdate && strings.HasPrefix(content, ProgressCardPayloadPrefix) {
		return fmt.Errorf("fixture unexpected EOF")
	}
	p.previewEdits = append(p.previewEdits, content)
	if id, ok := handle.(string); ok && p.livePreviews != nil {
		p.livePreviews[id] = content
	}
	return nil
}

func (p *cardCleanerPlatform) DeletePreviewMessage(_ context.Context, handle any) error {
	p.previewMu.Lock()
	defer p.previewMu.Unlock()
	if id, ok := handle.(string); ok {
		delete(p.livePreviews, id)
	}
	return nil
}

func (p *cardCleanerPlatform) liveChatMessages() []string {
	p.previewMu.Lock()
	var out []string
	for _, body := range p.livePreviews {
		if !strings.HasPrefix(body, ProgressCardPayloadPrefix) {
			out = append(out, body)
		}
	}
	p.previewMu.Unlock()
	out = append(out, p.getSent()...)
	return out
}

// Reproduces the 2026-11-23 05:00-05:06 devin (ACP) sequence: interim
// narration between tool calls and thinking boundaries under
// progress_style=card must stay out of chat, regardless of tool_messages /
// thinking_messages settings or mid-turn card transport failures.
func TestProcessInteractiveEvents_CardNarrationStaysOutOfChat(t *testing.T) {
	cases := []struct {
		name           string
		toolMessages   bool
		thinkingMsgs   bool
		failCardUpdate bool
	}{
		{name: "tool_off_thinking_off", toolMessages: false, thinkingMsgs: false},
		{name: "tool_off_thinking_on", toolMessages: false, thinkingMsgs: true},
		{name: "tool_on_thinking_off", toolMessages: true, thinkingMsgs: false},
		{name: "tool_off_thinking_on_card_eof", toolMessages: false, thinkingMsgs: true, failCardUpdate: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := &cardCleanerPlatform{
				stubCompactProgressPlatform: stubCompactProgressPlatform{
					stubPlatformEngine: stubPlatformEngine{n: "discord"},
					style:              "card",
					supportPayload:     true,
				},
				failCardUpdate: tc.failCardUpdate,
			}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
			e.SetDisplayConfig(DisplayCfg{
				Mode:             "full",
				ThinkingMessages: tc.thinkingMsgs,
				ToolMessages:     tc.toolMessages,
				ThinkingMaxLen:   300,
				ToolMaxLen:       500,
			})
			key := "discord:card-narration-" + tc.name
			session := e.sessions.GetOrCreateActive(key)
			as := newControllableSession("acp-narration-session")
			state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx"}
			e.interactiveStates[key] = state

			// ACP streams EventText chunks and finishes with empty EventResult{Done: true}.
			go func() {
				as.events <- Event{Type: EventText, Content: "三份交接写好，现在逐个交进工作区。"}
				as.events <- Event{Type: EventToolUse, ToolName: "bash", ToolInput: "ws-handoff 1"}
				as.events <- Event{Type: EventToolResult, ToolName: "bash", Content: "ok"}
				as.events <- Event{Type: EventText, Content: "第一件交出去了，继续第二件。"}
				as.events <- Event{Type: EventThinking, Content: "PRIVATE_THOUGHT_STEP"}
				as.events <- Event{Type: EventToolUse, ToolName: "bash", ToolInput: "ws-handoff 2"}
				as.events <- Event{Type: EventToolResult, ToolName: "bash", Content: "ok"}
				as.events <- Event{Type: EventText, Content: "【接】三件都交进工作区了。"}
				as.events <- Event{Type: EventResult, Done: true}
			}()

			e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, state.replyCtx)

			live := p.liveChatMessages()
			joined := strings.Join(live, "\n")
			for _, leak := range []string{"三份交接写好", "第一件交出去了", "PRIVATE_THOUGHT_STEP", "💭"} {
				if strings.Contains(joined, leak) {
					t.Errorf("interim content %q leaked into chat: live=%#v", leak, live)
				}
			}
			if len(live) != 1 || live[0] != "【接】三件都交进工作区了。" {
				t.Fatalf("live chat messages = %#v, want only the final reply", live)
			}
		})
	}
}
