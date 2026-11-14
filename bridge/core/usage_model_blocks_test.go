package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

func TestCmdUsage_LogsResponseAndFailureReason(t *testing.T) {
	for _, tc := range []struct {
		name   string
		agent  Agent
		status string
	}{
		{"success", &stubUsageAgent{report: &UsageReport{}}, "ok"},
		{"empty", &stubUsageAgent{}, "unavailable"},
		{"failure", &stubUsageAgent{err: errors.New("quota probe timed out")}, "fetch_error"},
		{"unsupported", &stubAgent{}, "unsupported"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
			defer slog.SetDefault(previous)
			p := &stubPlatformEngine{n: "plain"}
			e := NewEngine("test", tc.agent, []Platform{p}, "", LangEnglish)
			t.Cleanup(e.cancel)
			e.cmdUsage(p, &Message{SessionKey: "test:usage", ReplyCtx: "ctx"})
			var record map[string]any
			if err := json.Unmarshal(bytes.TrimSpace(logs.Bytes()), &record); err != nil {
				t.Fatal(err, logs.String())
			}
			if len(p.sent) != 1 || record["response"] != p.sent[0] || record["status"] != tc.status || record["session"] != "test:usage" {
				t.Fatalf("logs=%s replies=%v", logs.String(), p.sent)
			}
		})
	}
}

func TestCmdUsage_PreservesModelWindowsInTextAndCard(t *testing.T) {
	// Source: task #780 real panel: session 18%, all models 75%, Fable 34%.
	report := &UsageReport{Buckets: []UsageBucket{{Name: "Usage", Windows: []UsageWindow{
		{Name: "Current session", UsedPercent: 18, WindowSeconds: 18000},
		{Name: "Current week (all models)", UsedPercent: 75, WindowSeconds: 604800},
		{Name: "Current week (Fable)", UsedPercent: 34, WindowSeconds: 604800},
	}}}}
	for _, card := range []bool{false, true} {
		t.Run(map[bool]string{false: "text", true: "card"}[card], func(t *testing.T) {
			plain := &stubPlatformEngine{n: "test"}
			var p Platform = plain
			cards := &stubCardPlatform{stubPlatformEngine: *plain}
			if card {
				p = cards
			}
			e := NewEngine("test", &stubUsageAgent{report: report}, []Platform{p}, "", LangEnglish)
			t.Cleanup(e.cancel)
			e.handleCommand(p, &Message{SessionKey: "test:user1", ReplyCtx: "ctx"}, "/usage")
			var text string
			if card {
				if len(cards.repliedCards) != 1 {
					t.Fatalf("cards = %d", len(cards.repliedCards))
				}
				text = cards.repliedCards[0].RenderText()
			} else {
				if len(plain.sent) != 1 {
					t.Fatalf("messages = %v", plain.sent)
				}
				text = plain.sent[0]
			}
			for _, want := range []string{"Current session", "Current week (all models)", "Current week (Fable)", "Remaining: 82%", "Remaining: 25%", "Remaining: 66%"} {
				if !strings.Contains(text, want) {
					t.Errorf("missing %q in %q", want, text)
				}
			}
		})
	}
	if got := formatReplyFooterUsage(report, NewI18n(LangChinese)); got != "5h 剩 82% · 周 25%" {
		t.Fatalf("footer changed selection: %q", got)
	}
}

func TestFormatUsageReport_PreservesEveryBucketAndWindow(t *testing.T) {
	report := &UsageReport{Buckets: []UsageBucket{
		{Name: "Rate limit", Windows: []UsageWindow{{Name: "Primary", WindowSeconds: 604800, UsedPercent: 40}}},
		{Name: "Code review", Windows: []UsageWindow{{Name: "Primary", WindowSeconds: 604800, UsedPercent: 20}}},
	}}
	got := formatUsageReport(report, LangEnglish)
	for _, want := range []string{"Rate limit", "Code review", "Remaining: 60%", "Remaining: 80%"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
}
