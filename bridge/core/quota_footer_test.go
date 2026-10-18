package core

import (
	"context"
	"errors"
	"strings"
	"sync"
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
	ageReplyFooterUsage(e, time.Hour)
	_ = e.replyFooterUsageText(nil, a) // kicks a background refresh
	waitReplyFooterUsageIdle(t, e)
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 65%" {
		t.Fatal(got)
	}
	// A balance too old to trust is not presented as current once refreshes fail.
	a.err = errors.New("offline")
	ageReplyFooterUsage(e, time.Hour)
	_ = e.replyFooterUsageText(nil, a)
	waitReplyFooterUsageIdle(t, e)
	if got := e.replyFooterUsageText(nil, a); got != "额度查询失败" {
		t.Fatalf("stale balance presented as current: %s", got)
	}
}

// slowUsageAgent is a UsageReporter whose probe takes delay and can fail.
type slowUsageAgent struct {
	stubAgent
	delay   time.Duration
	mu      sync.Mutex
	used    int
	err     error
	calls   int
	running int
	maxRun  int
}

func (a *slowUsageAgent) set(used int, err error) {
	a.mu.Lock()
	a.used, a.err = used, err
	a.mu.Unlock()
}

func (a *slowUsageAgent) stats() (calls, maxRun int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.calls, a.maxRun
}

func (a *slowUsageAgent) GetUsage(ctx context.Context) (*UsageReport, error) {
	a.mu.Lock()
	a.calls++
	a.running++
	if a.running > a.maxRun {
		a.maxRun = a.running
	}
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.running--
		a.mu.Unlock()
	}()
	select {
	case <-time.After(a.delay):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.err != nil {
		return nil, a.err
	}
	return &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: a.used, WindowSeconds: 18000}}}}}, nil
}

// ageReplyFooterUsage pretends every cached result and attempt is older by d.
func ageReplyFooterUsage(e *Engine, d time.Duration) {
	e.replyFooterMu.Lock()
	defer e.replyFooterMu.Unlock()
	for _, ent := range e.replyFooterUsage {
		if !ent.okAt.IsZero() {
			ent.okAt = ent.okAt.Add(-d)
		}
		if !ent.attemptAt.IsZero() {
			ent.attemptAt = ent.attemptAt.Add(-d)
		}
	}
}

func waitReplyFooterUsageIdle(t *testing.T, e *Engine) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		e.replyFooterMu.Lock()
		busy := len(e.replyFooterInflight) > 0
		e.replyFooterMu.Unlock()
		if !busy {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("quota probe still running")
}

func TestQuotaFooter_SlowProbeDoesNotBlockFooter(t *testing.T) {
	e := newLegacyFooterEngine()
	e.i18n = NewI18n(LangChinese)
	a := &slowUsageAgent{delay: 2 * time.Second, used: 20}

	start := time.Now()
	got := e.replyFooterUsageText(nil, a)
	if elapsed := time.Since(start); elapsed > replyFooterUsageFirstWait+300*time.Millisecond {
		t.Fatalf("footer blocked %s on a slow probe", elapsed)
	}
	if got != "额度查询中" {
		t.Fatalf("first footer while probing = %q", got)
	}
	start = time.Now()
	if got := e.replyFooterUsageText(nil, a); got != "额度查询中" || time.Since(start) > 50*time.Millisecond {
		t.Fatalf("second footer waited or wrong: %q after %s", got, time.Since(start))
	}
	waitReplyFooterUsageIdle(t, e)
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 80%" {
		t.Fatalf("finished probe not shown: %q", got)
	}
}

func TestQuotaFooter_StaleValueRefreshedInBackground(t *testing.T) {
	e := newLegacyFooterEngine()
	e.i18n = NewI18n(LangChinese)
	a := &slowUsageAgent{delay: 10 * time.Millisecond, used: 20}
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 80%" {
		t.Fatalf("fast first probe = %q", got)
	}
	a.set(50, nil)
	a.delay = 300 * time.Millisecond
	// Fresh: served from cache, no new probe.
	_ = e.replyFooterUsageText(nil, a)
	if calls, _ := a.stats(); calls != 1 {
		t.Fatalf("fresh quota re-probed: %d calls", calls)
	}
	ageReplyFooterUsage(e, replyFooterUsageStaleAfter)
	start := time.Now()
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 80%" || time.Since(start) > 50*time.Millisecond {
		t.Fatalf("stale footer should show old value at once: %q after %s", got, time.Since(start))
	}
	waitReplyFooterUsageIdle(t, e)
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 50%" {
		t.Fatalf("background refresh not applied: %q", got)
	}
}

func TestQuotaFooter_FailedRefreshKeepsLastGoodValue(t *testing.T) {
	e := newLegacyFooterEngine()
	e.i18n = NewI18n(LangChinese)
	a := &slowUsageAgent{delay: time.Millisecond, used: 30}
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 70%" {
		t.Fatal(got)
	}
	a.set(0, errors.New("claude exited"))
	ageReplyFooterUsage(e, replyFooterUsageStaleAfter)
	_ = e.replyFooterUsageText(nil, a)
	waitReplyFooterUsageIdle(t, e)
	if calls, _ := a.stats(); calls != 2 {
		t.Fatalf("expected a refresh attempt, got %d calls", calls)
	}
	if got := e.replyFooterUsageText(nil, a); got != "额度剩余 70%" {
		t.Fatalf("failed refresh overwrote good value: %q", got)
	}
	// Failures are retried no faster than replyFooterUsageRetryAfter.
	_ = e.replyFooterUsageText(nil, a)
	if calls, _ := a.stats(); calls != 2 {
		t.Fatalf("failed refresh retried immediately: %d calls", calls)
	}
}

func TestQuotaFooter_FailureWithoutAnySuccess(t *testing.T) {
	e := newLegacyFooterEngine()
	e.i18n = NewI18n(LangChinese)
	a := &slowUsageAgent{delay: time.Millisecond, err: errors.New("claude exited")}
	if got := e.replyFooterUsageText(nil, a); got != "额度查询失败" {
		t.Fatalf("never-succeeded failure = %q", got)
	}
}

func TestQuotaFooter_SingleFlightPerAgent(t *testing.T) {
	e := newLegacyFooterEngine()
	e.i18n = NewI18n(LangChinese)
	a := &slowUsageAgent{delay: 300 * time.Millisecond, used: 10}
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = e.replyFooterUsageText(nil, a)
		}()
	}
	wg.Wait()
	waitReplyFooterUsageIdle(t, e)
	if calls, maxRun := a.stats(); calls != 1 || maxRun != 1 {
		t.Fatalf("concurrent footers probed %d times (max %d at once)", calls, maxRun)
	}
	// Another model of the same agent waits for the running probe instead of
	// starting a second one.
	m := &slowModelUsageAgent{slowUsageAgent: &slowUsageAgent{delay: 300 * time.Millisecond, used: 10}, model: "a"}
	_ = e.replyFooterUsageText(nil, m)
	m.model = "b"
	_ = e.replyFooterUsageText(nil, m)
	if _, maxRun := m.stats(); maxRun != 1 {
		t.Fatalf("two probes ran at once for one agent: %d", maxRun)
	}
	waitReplyFooterUsageIdle(t, e)
}

type slowModelUsageAgent struct {
	*slowUsageAgent
	model string
}

func (a *slowModelUsageAgent) GetModel() string { return a.model }

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

func TestQuotaFooter_ToggleConcurrentWithRead(t *testing.T) {
	e := newLegacyFooterEngine()
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			e.SetShowQuotaIndicator(i%2 == 0)
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			e.replyFooterUsageStatus(nil, nil)
		}
	}()
	wg.Wait()
}

type countingUsageAgent struct {
	stubFooterAgent
	calls int
}

func (a *countingUsageAgent) GetUsage(context.Context) (*UsageReport, error) {
	a.calls++
	return &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 35, WindowSeconds: 18000}}}}}, nil
}

func TestQuotaFooter_QuotaToggleKeepsStatusAndSkipsProbe(t *testing.T) {
	e := newLegacyFooterEngine()
	e.SetShowQuotaIndicator(false)
	s := newControllableSession("quota-off")
	s.model = "test-model"
	s.contextUsage = &ContextUsage{UsedTokens: 100, ContextWindow: 1000, CachedInputTokens: 50}
	a := &countingUsageAgent{stubFooterAgent: stubFooterAgent{model: "test-model"}}
	for name, got := range map[string]string{
		"plain":        e.buildReplyFooter(a, s, "", "[ctx: 10%]"),
		"rich":         e.composeRichStatusFooter(false, time.Now(), a, s, ""),
		"cache-status": e.buildClaudeStatusLineFooter(a, s, ""),
	} {
		if !strings.Contains(got, "test-model") || !strings.Contains(got, "10%") {
			t.Errorf("%s lost model or context: %q", name, got)
		}
		if strings.Contains(got, "quota") || strings.Contains(got, " ·  ·") || strings.HasSuffix(got, " · ") {
			t.Errorf("%s still shows quota or an empty segment: %q", name, got)
		}
	}
	if a.calls != 0 {
		t.Fatalf("quota probed %d times with the indicator off", a.calls)
	}
	if got := e.buildReplyFooter(a, nil, "", ""); got != "test-model" {
		t.Fatalf("footer without session should keep just the model: %q", got)
	}
	if a.calls != 0 {
		t.Fatalf("quota probed %d times with the indicator off", a.calls)
	}
}
