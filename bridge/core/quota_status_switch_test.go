package core

import (
	"context"
	"strings"
	"testing"
	"time"
)

// show_quota_status = false: when there is no measured quota (unsupported,
// no data, probing, probe failed) the footer says nothing about quota; a
// measured quota still shows. Default (true) keeps the status texts
// (TestQuotaFooter_UnsupportedIsExplicit / _StatesAndNoStaleBalance).
func TestQuotaStatusOff_NothingWithoutMeasuredQuota(t *testing.T) {
	e := newLegacyFooterEngine()
	e.ctx = context.Background()
	e.i18n = NewI18n(LangChinese)
	e.SetShowQuotaStatus(false)
	unsupported := &stubFooterAgent{model: "test-model"}
	for name, got := range map[string]string{
		"plain":   e.buildReplyFooter(unsupported, nil, "", ""),
		"rich":    e.composeRichStatusFooter(false, time.Now(), unsupported, nil, ""),
		"context": e.buildReplyFooter(unsupported, nil, "", "[ctx: 10%]"),
	} {
		if strings.Contains(got, "额度") {
			t.Errorf("%s footer shows a quota status without a quota: %q", name, got)
		}
	}
	a := &stubUsageAgent{}
	if got := e.replyFooterUsageText(nil, a); got != "" {
		t.Fatalf("no data: got %q, want nothing", got)
	}
	a.report = &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 35, WindowSeconds: 18000}}}}}
	ageReplyFooterUsage(e, time.Hour)
	_ = e.replyFooterUsageText(nil, a)
	waitReplyFooterUsageIdle(t, e)
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 65%" {
		t.Fatalf("measured quota: got %q", got)
	}
}
