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
				for _, kind := range []ProgressCardEntryKind{ProgressEntryToolUse, ProgressEntryToolResult, ProgressEntryInfo, ProgressEntryError} {
					got := w.AppendStructured(ProgressCardEntry{Kind: kind, Tool: "bash", Text: "private payload"}, "raw fallback")
					want := style == progressStyleCard && (kind == ProgressEntryToolUse || kind == ProgressEntryToolResult)
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
