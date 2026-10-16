package core

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// Keep the model on the live session different from the agent default: a
// queued model switch must not relabel the failed turn or select another pool.
type errorQuotaSession struct {
	*inputTestSession
	report *UsageReport
	err    error
	usage  *ContextUsage
}

func (s *errorQuotaSession) GetModel() string               { return "gemini-4-argon-medium" }
func (s *errorQuotaSession) GetContextUsage() *ContextUsage { return s.usage }
func (s *errorQuotaSession) GetUsage(context.Context) (*UsageReport, error) {
	return s.report, s.err
}

type errorQuotaAgent struct{ *controllableAgent }

func (a *errorQuotaAgent) GetModel() string { return "gemini-3.8-flash-medium" }

func TestCUJ_ErrorQuota_FailureQueueAndRecovery(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		used       int
		noData     bool
		err        error
		hideFooter bool
		hideStatus bool
		cacheUsage bool
	}{
		{name: "measured", used: 17, want: "额度剩余 83%"},
		{name: "exhausted", used: 100, want: "额度剩余 0%"},
		{name: "query_failed", err: errors.New("quota offline"), want: "额度查询失败"},
		{name: "no_data", noData: true, want: "额度暂无数据"},
		{name: "cache_status_line", used: 17, want: "额度剩余 83%", cacheUsage: true},
		{name: "footer_disabled", used: 17, hideFooter: true},
		{name: "status_disabled", used: 17, hideStatus: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			as := &errorQuotaSession{inputTestSession: &inputTestSession{
				events: make(chan Event, 16), prompts: make(chan string, 16), id: "quota-thread",
			}, err: tc.err}
			if !tc.noData && tc.err == nil {
				as.report = &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: tc.used, WindowSeconds: 604800}}}}}
			}
			if tc.cacheUsage {
				as.usage = &ContextUsage{ContextWindow: 1000, UsedTokens: 100, CachedInputTokens: 50}
			}
			a := &errorQuotaAgent{&controllableAgent{nextSession: as}}
			p := &stubPlatformEngine{n: "discord"}
			e := NewEngine("quota-test", a, []Platform{p}, "", LangChinese)
			e.SetReplyFooterEnabled(!tc.hideFooter)
			e.SetShowContextIndicator(!tc.hideStatus)
			s := e.sessions.GetOrCreateActive(inputTestKey)
			t.Cleanup(func() { e.cancel(); inputWait(t, func() bool { return !s.Busy() }); _ = e.Stop() })
			send := func(id string) {
				e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: p.Name(), MessageID: id, UserID: "human", Content: id, Mentioned: true, ReplyCtx: "local"})
			}
			waitPrompt := func() {
				t.Helper()
				inputPrompt(t, &inputTestAgent{session: as.inputTestSession})
			}
			checkFailure := func(body, marker string) {
				t.Helper()
				if !strings.Contains(body, marker) {
					t.Errorf("failure hidden: %q", body)
				}
				if tc.want != "" {
					if strings.Count(body, tc.want) != 1 || !strings.Contains(body, as.GetModel()) || strings.Contains(body, a.GetModel()) {
						t.Errorf("failed turn needs exactly one quota and its own model; want %q, tail=%q", tc.want, body[max(0, len(body)-250):])
					}
				} else if strings.Contains(body, "额度") || strings.Contains(body, as.GetModel()) {
					t.Error("failure footer ignores display controls")
				}
			}

			send("first")
			waitPrompt()
			send("queued")
			// Reproduce the provider's ERROR with a long, non-empty response.
			partial := strings.Repeat("partial answer ", maxPlatformMessageLen/7)
			as.events <- Event{Type: EventError, Error: errors.New("antigravity: stream turn failed (ERROR): " + partial)}
			waitPrompt() // Queue advancement proves the error send is complete.
			failure := strings.Join(p.getSent(), "\n")
			checkFailure(failure, "stream turn failed (ERROR)")
			if !strings.Contains(failure, "partial answer") {
				t.Error("partial response lost")
			}
			if tc.want != "" {
				parts := p.getSent()
				if !strings.Contains(parts[len(parts)-1], tc.want) {
					t.Error("quota must be on the final chunk")
				}
			}
			as.events <- Event{Type: EventResult, Content: "recovered-answer", SessionID: as.id, Done: true}
			inputWait(t, func() bool { return !s.Busy() })
			p.clearSent()
			send("empty-result")
			waitPrompt()
			as.events <- Event{Type: EventError, Error: ErrEmptyAgentResponse}
			inputWait(t, func() bool { return !s.Busy() })
			checkFailure(strings.Join(p.getSent(), "\n"), "后端结束了本轮")
			p.clearSent()
			send("provider-empty-error")
			waitPrompt()
			as.events <- Event{Type: EventError, Error: errors.New("antigravity: stream turn failed (ERROR): ")}
			inputWait(t, func() bool { return !s.Busy() })
			checkFailure(strings.Join(p.getSent(), "\n"), "stream turn failed (ERROR)")
			assistantTurns := 0
			for _, h := range s.GetHistory(0) {
				if h.Role == "assistant" {
					assistantTurns++
					if h.Content != "recovered-answer" {
						t.Error("failed answer or quota stored as successful history")
					}
				}
			}
			if assistantTurns != 1 || as.normal.Load() != 4 {
				t.Fatal("error recovery changed history or automatically retried a turn")
			}
		})
	}
}

type errorQuotaRichPlatform struct {
	stubCompactProgressPlatform
	failUpdate bool
}

func (p *errorQuotaRichPlatform) UpdateMessage(ctx context.Context, rc any, body string) error {
	if p.failUpdate {
		return errors.New("card update failed")
	}
	return p.stubCompactProgressPlatform.UpdateMessage(ctx, rc, body)
}

func TestErrorQuota_RichCardDeliveryAndFallback(t *testing.T) {
	for _, failUpdate := range []bool{false, true} {
		t.Run(map[bool]string{false: "card", true: "fallback"}[failUpdate], func(t *testing.T) {
			as := &errorQuotaSession{inputTestSession: &inputTestSession{events: make(chan Event, 8), prompts: make(chan string, 8), id: "quota-thread"},
				report: &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 17, WindowSeconds: 604800}}}}}}
			a := &errorQuotaAgent{&controllableAgent{nextSession: as}}
			p := &errorQuotaRichPlatform{stubCompactProgressPlatform: stubCompactProgressPlatform{stubPlatformEngine: stubPlatformEngine{n: "rich-test"}}, failUpdate: failUpdate}
			e := NewEngine("quota-rich", a, []Platform{p}, "", LangChinese)
			e.display.CardMode = "rich"
			e.display.ThinkingMessages = true
			e.SetReplyFooterEnabled(true)
			e.SetShowContextIndicator(true)
			s := e.sessions.GetOrCreateActive(inputTestKey)
			t.Cleanup(func() { e.cancel(); inputWait(t, func() bool { return !s.Busy() }); _ = e.Stop() })
			e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: p.Name(), UserID: "human", Content: "read only", Mentioned: true, ReplyCtx: "local"})
			inputPrompt(t, &inputTestAgent{session: as.inputTestSession})
			as.events <- Event{Type: EventThinking, Content: "working"}
			as.events <- Event{Type: EventError, Error: errors.New("provider turn failed")}
			inputWait(t, func() bool { return !s.Busy() })
			p.previewMu.Lock()
			cardText := strings.Join(p.previewEdits, "\n")
			p.previewMu.Unlock()
			text := strings.Join(p.getSent(), "\n")
			if !strings.Contains(text, "provider turn failed") || strings.Count(cardText+text, "额度剩余 83%") != 1 {
				t.Fatalf("failure or quota missing/duplicated: card=%q, text=%q", cardText, text)
			}
			if failUpdate != strings.Contains(text, "额度剩余 83%") {
				t.Fatal("inline quota must be used only if the rich card was not delivered")
			}
		})
	}
}
