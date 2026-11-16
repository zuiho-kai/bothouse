package core

import (
 "strings"
 "testing"
)

func TestUsageReportOmitsMissingAccount(t *testing.T) {
 report := &UsageReport{Provider: "claudecode", Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 42, WindowSeconds: 18000}}}}}
 got := formatUsageReport(report, LangChinese)
 if strings.Contains(got, "账号：") { t.Fatalf("unknown account should be omitted: %s", got) }
 report.Email = "example@example.invalid"
 if got := formatUsageReport(report, LangChinese); !strings.Contains(got, "账号：example@example.invalid") { t.Fatalf("known account missing: %s", got) }
}
