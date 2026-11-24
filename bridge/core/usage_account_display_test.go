package core

import (
	"strings"
	"testing"
	"time"
)

func TestUsageReportOmitsMissingAccount(t *testing.T) {
	report := &UsageReport{Provider: "claudecode", Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 42, WindowSeconds: 18000}}}}}
	got := formatUsageReport(report, LangChinese)
	if strings.Contains(got, "账号：") {
		t.Fatalf("unknown account should be omitted: %s", got)
	}
	report.Email = "example@example.invalid"
	if got := formatUsageReport(report, LangChinese); !strings.Contains(got, "账号：example@example.invalid") {
		t.Fatalf("known account missing: %s", got)
	}
}

func TestUsageCardAndFooterOmitExpiredWindow(t *testing.T) {
	report := &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{
		{Name: "Current session", UsedPercent: 42, WindowSeconds: 18000, ResetAtUnix: time.Now().Add(-time.Second).Unix()},
		{Name: "Current week", UsedPercent: 10, WindowSeconds: 604800, ResetAtUnix: time.Now().Add(time.Hour).Unix()},
	}}}}
	if got := formatUsageReport(report, LangChinese); strings.Contains(got, "58%") || strings.Contains(got, "5小时") || !strings.Contains(got, "90%") {
		t.Fatalf("expired session in card: %s", got)
	}
	if got := formatReplyFooterUsage(report, NewI18n(LangChinese)); got != "额度剩余 90%" {
		t.Fatalf("expired session in footer: %s", got)
	}
}

func TestUsageFooterCacheExpiresAtProviderReset(t *testing.T) {
	e := newLegacyFooterEngine()
	e.i18n = NewI18n(LangChinese)
	a := &stubUsageAgent{report: &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{
		{UsedPercent: 42, WindowSeconds: 18000, ResetAtUnix: time.Now().Add(time.Hour).Unix()},
	}}}}}
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 58%" {
		t.Fatal(got)
	}
	// Simulate the provider reset elapsing after the cached measurement was fetched.
	e.replyFooterMu.Lock()
	ent := e.replyFooterUsage[replyFooterUsageKey{agent: replyFooterAgentID(a)}]
	ent.footerReport.Buckets[0].Windows[0].ResetAtUnix = time.Now().Add(-time.Second).Unix()
	e.replyFooterMu.Unlock()
	if got := e.replyFooterUsageText(nil, a); got == "额度剩余 58%" {
		t.Fatalf("cached text survived the provider reset: %s", got)
	}
}
