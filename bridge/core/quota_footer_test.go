package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type scopedQuotaAgent struct {
	*stubUsageAgent
	model string
	seen  []string
}

func (a *scopedQuotaAgent) GetModel() string { return a.model }
func (a *scopedQuotaAgent) GetUsageForModel(_ context.Context, model string) (*UsageReport, error) {
	a.seen = append(a.seen, model)
	used := 10
	if model == "named" {
		used = 100
	}
	return &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: used}}}}}, nil
}

func TestQuotaFooterCacheSeparatesReplyModelsAndAgents(t *testing.T) {
	e := newLegacyFooterEngine()
	e.i18n = NewI18n(LangChinese)
	a := &scopedQuotaAgent{stubUsageAgent: &stubUsageAgent{}, model: "auto"}
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 90%" {
		t.Fatal(got)
	}
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 90%" || len(a.seen) != 1 {
		t.Fatal("cache not reused")
	}
	a.model = "named"
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 0%" {
		t.Fatal("model switch reused Auto quota", got)
	}
	// An in-flight session still uses its old model after a default switch.
	session := newControllableSession("quota-model")
	session.model = "auto"
	if got := e.replyFooterUsageText(session, a); got != "额度剩余 90%" {
		t.Fatal("pending model overrides reply model", got)
	}
	other := &scopedQuotaAgent{stubUsageAgent: &stubUsageAgent{}, model: "auto"}
	_ = e.replyFooterUsageText(nil, other)
	if len(other.seen) != 1 {
		t.Fatal("another agent inherited cached account balance")
	}
}

func TestQuotaFooterWeeklyOnlyAndExhaustedWeekly(t *testing.T) {
	i18n := NewI18n(LangChinese)
	for _, windows := range [][]UsageWindow{
		{{UsedPercent: 100, WindowSeconds: 604800}},
		{{UsedPercent: 10, WindowSeconds: 18000}, {UsedPercent: 100, WindowSeconds: 604800}},
	} {
		report := &UsageReport{Buckets: []UsageBucket{{Windows: windows}}}
		if got := formatReplyFooterUsage(report, i18n); got != "额度剩余 0%" {
			t.Fatalf("weekly limit hidden: %s", got)
		}
	}
}

func TestQuotaFooter_UnsupportedIsExplicit(t *testing.T) {
	e := newLegacyFooterEngine()
	e.ctx = context.Background()
	e.i18n = NewI18n(LangChinese)
	a := &stubFooterAgent{model: "test-model"}
	for name, got := range map[string]string{
		"plain":   e.buildReplyFooter(a, nil, "", ""),
		"rich":    e.composeRichStatusFooter(false, time.Now(), a, nil, ""),
		"context": e.buildReplyFooter(a, nil, "", "[ctx: 10%]"),
	} {
		if !strings.Contains(got, "额度暂不可查询") {
			t.Errorf("%s footer hides unavailable quota: %q", name, got)
		}
	}
}

func TestQuotaFooter_StatesAndNoStaleBalance(t *testing.T) {
	e := newLegacyFooterEngine()
	e.i18n = NewI18n(LangChinese)
	a := &stubUsageAgent{}
	if got := e.replyFooterUsageText(nil, a); got != "额度暂无数据" {
		t.Fatal(got)
	}
	a.report = &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 35, WindowSeconds: 18000}}}}}
	e.replyFooterUsage.fetchedAt = time.Now().Add(-time.Hour)
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 65%" {
		t.Fatal(got)
	}
	a.err = errors.New("offline")
	e.replyFooterUsage.fetchedAt = time.Now().Add(-time.Hour)
	if got := e.replyFooterUsageText(nil, a); got != "额度查询失败" {
		t.Fatalf("stale balance presented as current: %s", got)
	}
}

func TestQuotaFooter_ContextAndQuotaCoexist(t *testing.T) {
	e := newLegacyFooterEngine()
	s := newControllableSession("quota")
	s.model = "test-model"
	s.contextUsage = &ContextUsage{UsedTokens: 100, ContextWindow: 1000, CachedInputTokens: 50}
	s.report = &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 35, WindowSeconds: 18000}}}}}
	a := &stubFooterAgent{model: "test-model"}
	for name, got := range map[string]string{
		"plain":        e.buildReplyFooter(a, s, "", "[ctx: 10%]"),
		"rich":         e.composeRichStatusFooter(false, time.Now(), a, s, ""),
		"cache-status": e.buildClaudeStatusLineFooter(a, s, ""),
	} {
		if !strings.Contains(got, "10%") || !strings.Contains(got, "quota: 65% left") {
			t.Errorf("%s hides context or quota: %q", name, got)
		}
	}
	e.SetShowContextIndicator(false)
	if got := e.buildReplyFooter(a, s, "", ""); got != "" {
		t.Fatalf("status toggle ignored: %q", got)
	}
	if got := e.composeRichStatusFooter(false, time.Now(), a, s, ""); strings.Contains(got, "quota") {
		t.Fatal(got)
	}
	e.SetReplyFooterEnabled(false)
	if got := e.composeRichStatusFooter(false, time.Now(), a, s, ""); got != "" {
		t.Fatal(got)
	}
}

func TestQuotaFooter_EmptySessionReportFallsBackToAgent(t *testing.T) {
	e := newLegacyFooterEngine()
	s := &quotaEmptySession{controllableAgentSession: newControllableSession("empty")}
	a := &stubUsageAgent{report: &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 42, WindowSeconds: 18000}}}}}}
	if got := e.replyFooterUsageText(s, a); got != "quota: 58% left" {
		t.Fatal(got)
	}
}

type quotaEmptySession struct{ *controllableAgentSession }

func TestQuotaFooter_QuotaAloneIsStillUsefulStatus(t *testing.T) {
	e := newLegacyFooterEngine()
	a := &stubUsageAgent{report: &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 42, WindowSeconds: 18000}}}}}}
	for range 2 { // Fresh result and cached result must both remain visible.
		if got := e.buildReplyFooter(a, nil, "", ""); got != "quota: 58% left" {
			t.Fatalf("measured quota hidden without model: %q", got)
		}
	}
}

func (s *quotaEmptySession) GetUsage(context.Context) (*UsageReport, error) { return nil, nil }
