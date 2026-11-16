package core

import (
	"strings"
	"testing"
	"time"
)

// 11-16: the usage panel showed the weekly window at 100% while the provider kept
// answering. Every reply cleared the cooldown and the footer's panel read
// recorded it again a second later, six times in a row, each one moving the lead
// and the work away. The answer is the truth; the panel counts again only after
// the provider itself reports a quota error.
func TestQuotaAnswerOutranksUsagePanel(t *testing.T) {
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatal(err)
	}
	// The weekly reset four days ahead at 2pm Tokyo, as on 11-16 ("Nov 20 at 2pm").
	day := time.Now().In(tokyo).AddDate(0, 0, 4)
	reset := time.Date(day.Year(), day.Month(), day.Day(), 14, 0, 0, 0, tokyo)
	panel := func() *UsageReport {
		return &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{
			{WindowSeconds: 5 * 3600, UsedPercent: 20, ResetAtUnix: time.Now().Add(time.Hour).Unix()},
			{WindowSeconds: 7 * 24 * 3600, UsedPercent: 100, ResetAtUnix: reset.Unix()},
		}}}}
	}
	answer := Event{Type: EventResult, Done: true}
	status := func(e *Engine) string {
		e.waitQuotaUpdates()
		e.quotaMu.Lock()
		defer e.quotaMu.Unlock()
		return e.quotaState.ProbeStatus
	}

	t.Run("AnswerThenPanel", func(t *testing.T) {
		buf, restore := captureProbeLog(t)
		defer restore()
		e, _, _ := exitFixture(t, nil)
		e.observeQuotaEvent(answer, "discord:chat", nil)
		e.observeQuotaUsage(panel(), "discord:chat")
		if got := status(e); got == "exhausted" {
			t.Fatalf("probe status = %q after an answer", got)
		}
		if until := e.quotaCooling(); !until.IsZero() {
			t.Fatalf("panel reading cooled an answering provider until %v", until)
		}
		if strings.Contains(buf.String(), "provider reported exhaustion") {
			t.Fatalf("panel reading was logged as exhaustion: %s", buf.String())
		}
		if !strings.Contains(buf.String(), "provider is answering, not cooling") {
			t.Fatalf("ignored panel reading left no log line: %s", buf.String())
		}
	})

	t.Run("CoolingClearedByAnswerStaysClearThenErrorCools", func(t *testing.T) {
		e := setupQuotaTestEngine(t)
		// Nothing has answered yet: the panel is the only evidence and it cools.
		e.observeQuotaUsage(panel(), "discord:chat")
		if got := status(e); got != "exhausted" || !e.quotaCooling().Equal(reset) {
			t.Fatalf("panel without an answer: status=%q until=%v, want exhausted until %v", got, e.quotaCooling(), reset)
		}
		e.observeQuotaEvent(answer, "discord:chat", nil)
		e.waitQuotaUpdates()
		if until := e.quotaCooling(); !until.IsZero() {
			t.Fatalf("an answer did not clear the cooldown: %v", until)
		}
		// The tick finishes the recovery the answer started (lead, status).
		e.quotaTick(time.Now())
		// The same panel report arrives again, as the reply footer reads it.
		e.observeQuotaUsage(panel(), "discord:chat")
		if got := status(e); got == "exhausted" || !e.quotaCooling().IsZero() {
			t.Fatalf("same panel report after the answer: status=%q until=%v", got, e.quotaCooling())
		}

		// The provider refuses a turn: "You've hit your weekly limit · resets Nov 20 at 2pm (Asia/Tokyo)".
		limit := Event{Type: EventResult, Done: true, Metadata: map[string]any{
			MetaResultIsError:  true,
			MetaQuotaExhausted: reset.Format("Jan 2 at 3pm") + " (Asia/Tokyo)",
		}}
		e.observeQuotaEvent(limit, "discord:chat", nil)
		if got := status(e); got != "exhausted" || !e.quotaCooling().Equal(reset) {
			t.Fatalf("rate limit error: status=%q until=%v, want exhausted until %v", got, e.quotaCooling(), reset)
		}
		// After the error the panel counts again and does not undo the cooldown.
		e.observeQuotaUsage(panel(), "discord:chat")
		if got := status(e); got != "exhausted" || !e.quotaCooling().Equal(reset) {
			t.Fatalf("panel after the error: status=%q until=%v", got, e.quotaCooling())
		}
	})
}

func TestQuotaResetTimeDateAtClock(t *testing.T) {
	now := time.Date(2026, 11, 16, 14, 25, 34, 0, time.UTC) // 23:25 Tokyo
	for _, tc := range []struct {
		raw string
		at  time.Time
	}{
		{"Nov 20 at 2pm (Asia/Tokyo)", time.Date(2026, 11, 20, 5, 0, 0, 0, time.UTC)},
		{"Nov 20 at 2:30pm (Asia/Tokyo)", time.Date(2026, 11, 20, 5, 30, 0, 0, time.UTC)},
	} {
		got, ok := quotaResetTime(tc.raw, now)
		if !ok || !got.Equal(tc.at) {
			t.Fatalf("%q => %v, %v; want %v", tc.raw, got, ok, tc.at)
		}
	}
}
