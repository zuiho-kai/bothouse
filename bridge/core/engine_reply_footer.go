package core

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

func (e *Engine) buildReplyFooter(agent Agent, session AgentSession, workspaceDir string, contextLeft string) string {
	if !e.replyFooterEnabled || agent == nil {
		return ""
	}

	var parts []string
	hasStatus := false
	if e.showContextIndicator {
		contextLeft = strings.TrimSpace(contextLeft)
		contextFirst := strings.HasPrefix(contextLeft, "[ctx:")
		if contextFirst {
			parts = append(parts, contextLeft)
			hasStatus = true
		}
		if model := replyFooterModel(session, agent); model != "" {
			parts = append(parts, model)
			hasStatus = true
		}
		if effort := replyFooterReasoningEffort(session, agent); effort != "" {
			parts = append(parts, effort)
			hasStatus = true
		}
		if contextFirst {
			// Already added before model so "[ctx]" stays on the same footer line.
		} else if contextLeft != "" {
			parts = append(parts, contextLeft)
			hasStatus = true
		}
		if usage, hasQuota := e.replyFooterUsageStatus(session, agent); usage != "" && (hasStatus || hasQuota) {
			parts = append(parts, usage)
			hasStatus = true
		}
	}
	if e.showWorkdirIndicator {
		if dir := replyFooterWorkDir(session, agent, workspaceDir); dir != "" {
			parts = append(parts, dir)
		}
	}
	// A workdir alone is not a useful status signal (see #701), so suppress
	// the entire footer unless at least one status segment from line 1 is
	// present.
	if !hasStatus {
		return ""
	}
	return strings.Join(parts, " · ")
}

// composeRichStatusFooter assembles the multi-line statusFooter passed to
// RichCardSupporter.BuildRichCard. Layout (skipping any empty line):
//
//	line 1: ⏱ <i18n elapsed>                                  (subject to e.replyFooterEnabled)
//	line 2: model · out N · in N cw N cr N · ctx N%           (subject to e.showContextIndicator)
//	line 3: quota or availability                             (subject to e.showContextIndicator)
//	line 4: <workdir>                                         (subject to e.showWorkdirIndicator)
//
// Returns "" when the master replyFooterEnabled toggle is off, or while the
// turn is still streaming (footer represents finalized turn metadata —
// token counts aren't yet settled and a live-updating elapsed line creates
// visual noise during streaming. Header status badge already signals "Working").
func (e *Engine) composeRichStatusFooter(streaming bool, turnStart time.Time, agent Agent, session AgentSession, workspaceDir string) string {
	if !e.replyFooterEnabled {
		return ""
	}
	if streaming {
		return ""
	}
	var lines []string

	// Line 1: elapsed timer (now always the "done" form since streaming branch returned above)
	lines = append(lines, formatElapsed(time.Since(turnStart), streaming, e.i18n.currentLang()))

	// Line 2: model + effort + token usage detail + ctx %
	if e.showContextIndicator {
		usage := replyFooterSessionContextUsage(session)
		model := replyFooterModel(session, agent)
		effort := replyFooterReasoningEffort(session, agent)
		if line := buildClaudeStatusLineFooter(model, effort, usage); line != "" {
			lines = append(lines, line)
		}
		if quota := e.replyFooterUsageText(session, agent); quota != "" {
			lines = append(lines, quota)
		}
	}

	// Last line: workdir
	if e.showWorkdirIndicator {
		if dir := replyFooterWorkDir(session, agent, workspaceDir); dir != "" {
			lines = append(lines, dir)
		}
	}

	return strings.Join(lines, "\n")
}

// buildClaudeStatusLineFooter renders the rich-card line-2 token-usage detail:
//
//	claude-opus-4-7[1m] · xhigh · out 168 · in 1 cw 971 cr 40.8k · ctx 4%
//
// Sections (each skipped when its data is missing):
//   - model: from session GetModel() / agent.Name()
//   - effort: reasoning_effort (Codex / Claude high/medium/low/xhigh)
//   - token counts: out (output) · in (new input) · cw (cache create) · cr (cache read)
//   - ctx %: UsedTokens / ContextWindow, capped at 100%
//
// Returns "" when usage is nil and no model is known.
func buildClaudeStatusLineFooter(model, effort string, usage *ContextUsage) string {
	var parts []string
	if model != "" {
		parts = append(parts, model)
	}
	if effort != "" {
		parts = append(parts, effort)
	}
	if usage != nil {
		var counts []string
		if usage.OutputTokens > 0 {
			counts = append(counts, fmt.Sprintf("out %s", formatStatusTokenCount(usage.OutputTokens)))
		}
		if usage.InputTokens > 0 {
			counts = append(counts, fmt.Sprintf("in %s", formatStatusTokenCount(usage.InputTokens)))
		}
		if usage.CacheCreationInputTokens > 0 {
			counts = append(counts, fmt.Sprintf("cw %s", formatStatusTokenCount(usage.CacheCreationInputTokens)))
		}
		if usage.CachedInputTokens > 0 {
			counts = append(counts, fmt.Sprintf("cr %s", formatStatusTokenCount(usage.CachedInputTokens)))
		}
		if len(counts) > 0 {
			parts = append(parts, strings.Join(counts, " "))
		}
		if usage.ContextWindow > 0 {
			used := usage.UsedTokens
			if used <= 0 && usage.TotalTokens > 0 {
				used = usage.TotalTokens
			}
			if used > 0 {
				pct := used * 100 / usage.ContextWindow
				if pct > 100 {
					pct = 100
				}
				parts = append(parts, fmt.Sprintf("ctx %d%%", pct))
			}
		}
	}
	return strings.Join(parts, " · ")
}

// formatStatusTokenCount renders an integer token count compactly.
//
//	< 1000      -> "168"
//	< 1_000_000 -> "40.8k"
//	else        -> "1.2M"
//
// Negative inputs clamp to zero (defensive against bad token deltas).
func formatStatusTokenCount(n int) string {
	if n < 0 {
		n = 0
	}
	switch {
	case n < 1000:
		return fmt.Sprintf("%d", n)
	case n < 1_000_000:
		return fmt.Sprintf("%.1fk", float64(n)/1000.0)
	default:
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000.0)
	}
}

// formatElapsed renders a turn elapsed duration with i18n, in the format used
// at the top of the rich card status footer.
//
// Streaming = true → "⏱ 运行中 12.3 秒..." / "⏱ Running for 12.3s..."
// Streaming = false → "⏱ 用时 1 分 23 秒"  / "⏱ Elapsed 1m 23s"
//
// Currently supports ZH-family (zh / zh-tw) and EN-default. Other languages
// (ja / es) fall back to EN format. Could be promoted to full MsgKey i18n
// later if needed.
func formatElapsed(d time.Duration, streaming bool, lang Language) string {
	if d < 0 {
		d = 0
	}
	zh := lang == LangChinese || lang == LangTraditionalChinese
	totalSec := int64(d / time.Second)
	var dur string
	switch {
	case d < time.Minute:
		if zh {
			dur = fmt.Sprintf("%.1f 秒", d.Seconds())
		} else {
			dur = fmt.Sprintf("%.1fs", d.Seconds())
		}
	case d < time.Hour:
		m := totalSec / 60
		s := totalSec % 60
		if zh {
			dur = fmt.Sprintf("%d 分 %02d 秒", m, s)
		} else {
			dur = fmt.Sprintf("%dm %02ds", m, s)
		}
	default:
		h := totalSec / 3600
		m := (totalSec % 3600) / 60
		if zh {
			dur = fmt.Sprintf("%d 小时 %02d 分", h, m)
		} else {
			dur = fmt.Sprintf("%dh %02dm", h, m)
		}
	}
	if streaming {
		if zh {
			return fmt.Sprintf("⏱ 运行中 %s...", dur)
		}
		return fmt.Sprintf("⏱ Running for %s...", dur)
	}
	if zh {
		return fmt.Sprintf("⏱ 用时 %s", dur)
	}
	return fmt.Sprintf("⏱ Elapsed %s", dur)
}

func replyFooterModel(session AgentSession, agent Agent) string {
	if session != nil {
		if getter, ok := session.(interface{ GetModel() string }); ok {
			if model := displayModelName(getter.GetModel()); model != "" {
				return model
			}
		}
	}
	if getter, ok := agent.(interface{ GetModel() string }); ok {
		return displayModelName(getter.GetModel())
	}
	return ""
}

func replyFooterReasoningEffort(session AgentSession, agent Agent) string {
	if session != nil {
		if getter, ok := session.(interface{ GetReasoningEffort() string }); ok {
			if effort := strings.TrimSpace(getter.GetReasoningEffort()); effort != "" {
				return effort
			}
		}
	}
	if getter, ok := agent.(interface{ GetReasoningEffort() string }); ok {
		return strings.TrimSpace(getter.GetReasoningEffort())
	}
	return ""
}

func (e *Engine) replyFooterUsageText(session AgentSession, agent Agent) string {
	text, _ := e.replyFooterUsageStatus(session, agent)
	return text
}

// The boolean distinguishes a measured quota from an availability message, so
// an unknown quota alone does not resurrect a workdir-only footer.
func (e *Engine) replyFooterUsageStatus(session AgentSession, agent Agent) (string, bool) {
	text, measured := e.replyFooterQuota(session, agent)
	if !measured && e.hideQuotaStatus.Load() {
		return "", false
	}
	return text, measured
}

func (e *Engine) replyFooterQuota(session AgentSession, agent Agent) (string, bool) {
	if e.hideQuotaIndicator.Load() {
		return "", false
	}
	// maomao fork: quota the session already holds (CachedUsageReporter, no I/O) wins.
	if cached, ok := session.(CachedUsageReporter); ok {
		e.observeQuotaUsageFor(cached.CachedUsage(), "", e.quotaScopeFor(agent, replyFooterModel(session, agent)))
	}
	if text := replyFooterCachedQuotaText(session, e.i18n); text != "" {
		return text, true
	}
	if !supportsUsageReporting(session, agent) {
		return e.i18n.T(MsgQuotaUnsupported), false
	}
	parent := e.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, replyFooterUsageTimeout)
	defer cancel()
	status := e.i18n.T(MsgQuotaNoData)

	if session != nil {
		if reporter, ok := session.(UsageReporter); ok && usageReporterAvailable(session) {
			// The footer may run after a queued provider switch. Attribute this
			// existing session read to its creation scope, just like terminal events.
			var scope quotaScope
			if adapter, ok := agent.(SessionScopedUsageCapability); ok && adapter.UsageScopedToSession() {
				e.interactiveMu.Lock()
				for _, state := range e.interactiveStates {
					if state.agentSession == session {
						scope = state.quotaScope
						break
					}
				}
				e.interactiveMu.Unlock()
			}
			// An untracked session has no proven creation scope; its footer
			// still works, but do not assign its report to the current account.
			if report, err := reporter.GetUsage(ctx); err == nil {
				if scope.Provider != "" {
					e.cacheRoleQuotaReport(agent, replyFooterModel(session, agent), scope, report)
				}
				e.observeQuotaUsageFor(report, "", e.quotaScopeFor(agent, replyFooterModel(session, agent)))
				if text := formatReplyFooterUsage(report, e.i18n); text != "" {
					return text, true
				}
			} else {
				status = e.i18n.T(MsgQuotaFetchFailed)
			}
		}
	}

	reporter, ok := agent.(UsageReporter)
	if !ok || !usageReporterAvailable(agent) {
		return status, false
	}
	model := replyFooterModel(session, agent)
	agentID := replyFooterAgentID(agent)
	key := replyFooterUsageKey{agent: agentID, model: model}

	// The footer never blocks on the agent probe: it shows the last known
	// quota and refreshes it in the background, one probe per agent at a time.
	// Only the very first probe gets a short wait so fast reporters still show
	// a quota on the first reply.
	e.replyFooterMu.Lock()
	if e.replyFooterUsage == nil {
		e.replyFooterUsage = make(map[replyFooterUsageKey]*replyFooterUsageEntry)
		e.replyFooterInflight = make(map[any]bool)
	}
	ent := e.replyFooterUsage[key]
	if ent == nil {
		ent = &replyFooterUsageEntry{}
		e.replyFooterUsage[key] = ent
	}
	now := time.Now()
	retryDue := ent.attemptAt.IsZero() || now.Sub(ent.attemptAt) >= replyFooterUsageRetryAfter
	stale := ent.okAt.IsZero() || now.Sub(ent.okAt) >= replyFooterUsageStaleAfter
	if ent.done == nil && !e.replyFooterInflight[agentID] && stale && retryDue {
		ent.done = make(chan struct{})
		e.replyFooterInflight[agentID] = true
		go e.refreshReplyFooterUsage(e.quotaScopeFor(agent, model), reporter, agent, model, agentID, ent)
	}
	var wait chan struct{}
	if ent.done != nil && ent.okAt.IsZero() && ent.attemptAt.IsZero() && !ent.waited {
		wait, ent.waited = ent.done, true
	}
	e.replyFooterMu.Unlock()

	if wait != nil {
		timer := time.NewTimer(replyFooterUsageFirstWait)
		select {
		case <-wait:
		case <-timer.C:
		}
		timer.Stop()
	}

	e.replyFooterMu.Lock()
	defer e.replyFooterMu.Unlock()
	switch {
	case !ent.okAt.IsZero() && time.Since(ent.okAt) < replyFooterUsageMaxAge:
		// Render the retained measurement so its reset still expires between probes.
		if text := formatReplyFooterUsage(ent.footerReport, e.i18n); text != "" {
			return text, true
		}
		return e.i18n.T(MsgQuotaNoData), false
	case ent.done != nil || (ent.attemptAt.IsZero() && e.replyFooterInflight[agentID]):
		return e.i18n.T(MsgQuotaPending), false
	case ent.failText != "":
		return ent.failText, false
	default:
		return status, false
	}
}

// refreshReplyFooterUsage runs one agent quota probe. A failed or empty
// result never replaces the last good quota.
func (e *Engine) refreshReplyFooterUsage(scope quotaScope, reporter UsageReporter, agent Agent, model string, agentID any, ent *replyFooterUsageEntry) {
	parent := e.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, replyFooterUsageProbeTimeout)
	defer cancel()

	var report *UsageReport
	var err error
	if scoped, ok := agent.(ModelUsageReporter); ok {
		report, err = scoped.GetUsageForModel(ctx, model)
	} else {
		report, err = reporter.GetUsage(ctx)
	}
	// An empty report leaves failText empty so the footer falls back to the
	// session-level status, as before.
	text, failText := "", ""
	if err != nil {
		slog.Debug("reply footer: quota probe failed", "agent", agent.Name(), "model", model, "error", err)
		failText = e.i18n.T(MsgQuotaFetchFailed)
	} else {
		// Non-caching reporters return a freshly fetched result. Cached reporters
		// carry their original observation time, including after a failed refresh.
		if report != nil && report.ObservedAt.IsZero() {
			fresh := *report
			fresh.ObservedAt = time.Now()
			report = &fresh
		}
		e.cacheRoleQuotaReport(agent, model, scope, report)
		e.observeQuotaUsageFor(report, "", scope)
		text = formatReplyFooterUsage(report, e.i18n)
	}

	e.replyFooterMu.Lock()
	defer e.replyFooterMu.Unlock()
	ent.attemptAt = time.Now()
	if text != "" {
		ent.footerReport, ent.okAt, ent.failText = report, ent.attemptAt, ""
	} else {
		ent.failText = failText
	}
	close(ent.done)
	ent.done = nil
	delete(e.replyFooterInflight, agentID)
}

func replyFooterAgentID(agent Agent) any {
	if reflect.ValueOf(agent).Comparable() {
		return agent
	}
	return agent.Name()
}

func supportsUsageReporting(session AgentSession, agent Agent) bool {
	return usageReporterAvailable(session) || usageReporterAvailable(agent)
}

func usageReporterAvailable(v any) bool {
	if capability, ok := v.(UsageCapability); ok && !capability.SupportsUsageReporting() {
		return false
	}
	_, ok := v.(UsageReporter)
	return ok
}

// cacheRoleQuotaReport retains data already obtained by the reply footer. The
// management page never calls adapter CachedUsage methods: some refresh in the
// background despite the interface name. Keep attribution and age with the copy.
func (e *Engine) cacheRoleQuotaReport(agent Agent, model string, scope quotaScope, report *UsageReport) {
	if report == nil || report.ObservedAt.IsZero() || (report.QuotaGroup != "" && report.QuotaGroup != scope.Group) {
		return
	}
	if report.AccountID != "" && report.AccountID != scope.Account {
		return // The credential used by a delayed read must match its captured scope.
	}
	snapshot := *report
	snapshot.Buckets = nil
	for _, bucket := range report.Buckets {
		if report.QuotaGroup != "" && bucket.QuotaGroup != report.QuotaGroup {
			continue
		}
		bucket.Windows = append([]UsageWindow(nil), bucket.Windows...)
		snapshot.Buckets = append(snapshot.Buckets, bucket)
	}
	primary, secondary := selectUsageWindows(&snapshot)
	if primary == nil && secondary == nil {
		return
	}
	e.replyFooterMu.Lock()
	defer e.replyFooterMu.Unlock()
	if e.replyFooterUsage == nil {
		e.replyFooterUsage = make(map[replyFooterUsageKey]*replyFooterUsageEntry)
		e.replyFooterInflight = make(map[any]bool)
	}
	key := replyFooterUsageKey{agent: replyFooterAgentID(agent), model: model}
	ent := e.replyFooterUsage[key]
	if ent == nil {
		ent = &replyFooterUsageEntry{}
		e.replyFooterUsage[key] = ent
	}
	ent.report, ent.reportScope, ent.reportAt = &snapshot, scope.key(), report.ObservedAt
}

// CachedQuotaReport reads only the retained snapshot for this agent/model and
// current provider/account. No adapter usage method, probe, or refresh is called.
func (e *Engine) CachedQuotaReport(_ AgentSession, model string) *UsageReport {
	scope := e.quotaScopeFor(e.agent, model)
	e.replyFooterMu.Lock()
	defer e.replyFooterMu.Unlock()
	ent := e.replyFooterUsage[replyFooterUsageKey{agent: replyFooterAgentID(e.agent), model: model}]
	if ent == nil || ent.report == nil || ent.reportScope != scope.key() || ent.reportAt.IsZero() || time.Since(ent.reportAt) >= replyFooterUsageMaxAge {
		return nil
	}
	// Sparse updates retain independently observed windows. A newer primary
	// must not extend an untouched weekly window or its relative reset.
	snapshot := *ent.report
	snapshot.Buckets = nil
	now := time.Now()
	for _, bucket := range ent.report.Buckets {
		windows := make([]UsageWindow, 0, len(bucket.Windows))
		for _, window := range bucket.Windows {
			observed := window.ObservedAt
			if observed.IsZero() {
				observed = ent.reportAt
			}
			if now.Sub(observed) >= replyFooterUsageMaxAge {
				continue
			}
			reset := time.Unix(window.ResetAtUnix, 0)
			if window.ResetAtUnix == 0 && window.ResetAfterSeconds > 0 {
				reset = observed.Add(time.Duration(window.ResetAfterSeconds) * time.Second)
			}
			if (window.ResetAtUnix > 0 || window.ResetAfterSeconds > 0) && !reset.After(now) {
				if window.ObservedAt.IsZero() {
					return nil // Preserve reset behavior for adapters without per-window observations.
				}
				continue
			}
			windows = append(windows, window)
		}
		bucket.Windows = windows
		if len(windows) > 0 {
			snapshot.Buckets = append(snapshot.Buckets, bucket)
		}
	}
	if len(snapshot.Buckets) == 0 {
		return nil
	}
	return &snapshot
}

// replyFooterCachedQuotaText formats the quota a session already holds
// (CachedUsageReporter). It never does I/O, so it is safe to call on every
// reply. Returns "" when the session has no such data.
func replyFooterCachedQuotaText(session AgentSession, i18n *I18n) string {
	if session == nil {
		return ""
	}
	reporter, ok := session.(CachedUsageReporter)
	if !ok {
		return ""
	}
	return formatReplyFooterUsage(reporter.CachedUsage(), i18n)
}

// formatReplyFooterUsage renders the quota segment of the reply footer:
//
//	zh: "5h 剩 94% · 周 92%"   en: "5h 94% left · wk 92%"
//
// The first window carries the "left" wording; a following window (weekly)
// shows only its label and percent. Returns "" without a usable window.
func formatReplyFooterUsage(report *UsageReport, i18n *I18n) string {
	if report == nil || i18n == nil {
		return ""
	}
	primary, secondary := selectUsageWindows(report)
	var windows []*UsageWindow
	for _, w := range []*UsageWindow{primary, secondary} {
		if w != nil {
			windows = append(windows, w)
		}
	}
	if len(windows) == 0 {
		return ""
	}
	if len(windows) == 1 {
		// One window: no label needed ("额度剩余 83%"); two: each labelled
		// ("5h 剩 94% · 周 92%") so neither limit is hidden.
		remaining := min(max(100-windows[0].UsedPercent, 0), 100) // percent scale
		return i18n.Tf(MsgQuotaRemaining, remaining)
	}
	lang := i18n.CurrentLang()
	parts := make([]string, 0, len(windows))
	for i, w := range windows {
		remaining := 100 - w.UsedPercent // percent scale
		if remaining < 0 {
			remaining = 0
		}
		if remaining > 100 { // percent scale
			remaining = 100 // percent scale
		}
		label := usageWindowShortLabel(lang, w.WindowSeconds)
		switch {
		case label == "":
			parts = append(parts, i18n.Tf(MsgQuotaRemaining, remaining))
		case i == 0:
			parts = append(parts, i18n.Tf(MsgReplyFooterQuotaRemaining, label, remaining))
		default:
			parts = append(parts, fmt.Sprintf("%s %d%%", label, remaining))
		}
	}
	return strings.Join(parts, " · ")
}

// usageWindowShortLabel is the compact footer label for a quota window
// ("5h", "周"/"wk", or "<n>h"/"<n>d" for other whole-hour windows).
func usageWindowShortLabel(lang Language, seconds int) string {
	const hour = 3600     // seconds per hour
	const day = 24 * hour // seconds per day
	const week = 7 * day  // seconds per week (604800, same as selectUsageWindows)
	switch {
	case seconds <= 0:
		return ""
	case seconds == week:
		switch lang {
		case LangChinese:
			return "周"
		case LangTraditionalChinese, LangJapanese:
			return "週"
		case LangSpanish:
			return "sem"
		default:
			return "wk"
		}
	case seconds%day == 0:
		return fmt.Sprintf("%dd", seconds/day)
	case seconds%hour == 0:
		return fmt.Sprintf("%dh", seconds/hour)
	}
	return ""
}

func replyFooterSessionContextUsage(session AgentSession) *ContextUsage {
	if session == nil {
		return nil
	}
	reporter, ok := session.(ContextUsageReporter)
	if !ok {
		return nil
	}
	return reporter.GetContextUsage()
}

func replyFooterContextText(usage *ContextUsage, i18n *I18n) string {
	if usage == nil || i18n == nil {
		return ""
	}
	if usage.ContextWindow <= 0 {
		return ""
	}

	usedTokens := usage.UsedTokens
	if usedTokens <= 0 {
		switch {
		case usage.TotalTokens > 0:
			usedTokens = usage.TotalTokens
		case usage.InputTokens > 0 || usage.OutputTokens > 0:
			usedTokens = usage.InputTokens + usage.OutputTokens
		default:
			return ""
		}
	}

	baseline := usage.BaselineTokens
	if baseline < 0 {
		baseline = 0
	}
	if usage.ContextWindow <= baseline {
		return i18n.Tf(MsgReplyFooterRemaining, 0)
	}

	effectiveWindow := usage.ContextWindow - baseline
	effectiveUsed := usedTokens - baseline
	if effectiveUsed < 0 {
		effectiveUsed = 0
	}
	remaining := effectiveWindow - effectiveUsed
	if remaining < 0 {
		remaining = 0
	}

	left := int(math.Round(float64(remaining) / float64(effectiveWindow) * 100))
	if left < 0 {
		left = 0
	}
	if left > 100 {
		left = 100
	}
	return i18n.Tf(MsgReplyFooterRemaining, left)
}

func replyFooterWorkDir(session AgentSession, agent Agent, workspaceDir string) string {
	dir := strings.TrimSpace(workspaceDir)
	if dir == "" {
		if session != nil {
			if wd, ok := session.(interface{ GetWorkDir() string }); ok {
				dir = strings.TrimSpace(wd.GetWorkDir())
			}
		}
	}
	if dir == "" {
		if switcher, ok := agent.(WorkDirSwitcher); ok {
			dir = strings.TrimSpace(switcher.GetWorkDir())
		}
	}
	if dir == "" {
		if wd, ok := agent.(interface{ GetWorkDir() string }); ok {
			dir = strings.TrimSpace(wd.GetWorkDir())
		}
	}
	if dir == "" {
		return ""
	}
	return compactReplyFooterPath(dir)
}

func compactReplyFooterPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	cleaned := filepath.Clean(path)
	normalized := normalizeWorkspacePath(cleaned)
	if home, err := os.UserHomeDir(); err == nil {
		homeCleaned := filepath.Clean(home)
		homeNormalized := normalizeWorkspacePath(homeCleaned)
		for _, candidate := range []struct {
			path string
			home string
		}{
			{cleaned, homeCleaned},
			{normalized, homeNormalized},
			{cleaned, homeNormalized},
			{normalized, homeCleaned},
		} {
			if display, ok := replyFooterHomeRelativePath(candidate.path, candidate.home); ok {
				return display
			}
		}
	}
	return filepath.ToSlash(normalized)
}

func replyFooterHomeRelativePath(path, home string) (string, bool) {
	if path == "" || home == "" {
		return "", false
	}
	if path == home {
		return "~", true
	}
	prefix := home + string(os.PathSeparator)
	if strings.HasPrefix(path, prefix) {
		return "~" + filepath.ToSlash(strings.TrimPrefix(path, home)), true
	}
	return "", false
}

// buildClaudeStatusLineFooter renders a CCD-statusline-style footer for the
// reply, composed of two lines:
//
//	line 1 (controlled by show_context_indicator): <model id> · [effort:X ·] out N · in N cw N cr N · ctx N%
//	line 2 (controlled by show_workdir_indicator): <workspace dir>
//
// Returns "" if reply_footer is disabled, or if the active session does not
// expose per-turn cache-token data (i.e. this is not claudecode or no result
// event has arrived yet) so callers fall back to the default footer.
func (e *Engine) buildClaudeStatusLineFooter(agent Agent, session AgentSession, workspaceDir string) string {
	if !e.replyFooterEnabled {
		return ""
	}
	usage := replyFooterSessionContextUsage(session)
	if usage == nil || usage.ContextWindow <= 0 {
		return ""
	}
	// Only emit the CCD-style footer when we have the cache-token signals
	// that CCD's statusline consumes. Other agents (codex, gemini) fall
	// through to the default footer.
	if usage.CachedInputTokens == 0 && usage.CacheCreationInputTokens == 0 {
		return ""
	}

	var line1 string
	if e.showContextIndicator {
		used := usage.UsedTokens
		if used <= 0 {
			used = usage.InputTokens + usage.CachedInputTokens + usage.CacheCreationInputTokens
		}
		pct := int(math.Round(float64(used) * 100 / float64(usage.ContextWindow)))
		if pct < 0 {
			pct = 0
		}
		if pct > 100 {
			pct = 100
		}

		// Compose:
		//   <model id> · [effort:X ·] out N · in N cw N cr N · ctx N%
		// `·` separates major segments; tokens-in tier (in/cw/cr) groups under
		// one segment because cw/cr are just cache-tiered variants of input.
		// Raw model id is preserved (e.g. "claude-opus-4-7[1m]") for diagnostic
		// clarity over a prettified display name.
		var line1Parts []string
		if model := strings.TrimSpace(replyFooterModel(session, agent)); model != "" {
			line1Parts = append(line1Parts, model)
		}
		if effort := strings.TrimSpace(replyFooterReasoningEffort(session, agent)); effort != "" {
			line1Parts = append(line1Parts, "effort:"+effort)
		}
		line1Parts = append(line1Parts, fmt.Sprintf("out %s", formatStatusTokenCount(usage.OutputTokens)))
		line1Parts = append(line1Parts, fmt.Sprintf("in %s cw %s cr %s",
			formatStatusTokenCount(usage.InputTokens),
			formatStatusTokenCount(usage.CacheCreationInputTokens),
			formatStatusTokenCount(usage.CachedInputTokens)))
		line1Parts = append(line1Parts, fmt.Sprintf("ctx %d%%", pct))
		if quota := e.replyFooterUsageText(session, agent); quota != "" {
			line1Parts = append(line1Parts, quota)
		}
		line1 = strings.Join(line1Parts, " · ")
	}

	var line2 string
	if e.showWorkdirIndicator {
		line2 = replyFooterWorkDir(session, agent, workspaceDir)
	}

	switch {
	case line1 != "" && line2 != "":
		return line1 + "\n" + line2
	case line1 != "":
		return line1
	case line2 != "":
		return line2
	default:
		return ""
	}
}

// sendChunksWithStatusFooter splits body across maxPlatformMessageLen and sends
// each chunk via the supplied sendFn. The final chunk carries the structured
// statusFooter: platforms implementing StatusFooterSender render it as a
// small/dim block; otherwise the footer is appended inline via
// appendReplyFooter. Returns true on success, false if any send failed (in
// which case caller should bail). sendFn is the workspace-aware send closure
// (so the helper picks up workspace transforms like path remapping).
func sendChunksWithStatusFooter(ctx context.Context, p Platform, replyCtx any, body, statusFooter string, sendFn func(Platform, any, string) error) bool {
	chunks := SplitMessageCodeFenceAware(body, maxPlatformMessageLen)
	for i, chunk := range chunks {
		isLast := i == len(chunks)-1
		if isLast && statusFooter != "" {
			if sfs, ok := p.(StatusFooterSender); ok {
				if err := authorizedOutput(ctx, func() error { return sfs.SendWithStatusFooter(ctx, replyCtx, chunk, statusFooter) }); err == nil {
					continue
				} else {
					slog.Warn("SendWithStatusFooter failed, falling back to inline footer", "error", err)
				}
			}
			chunk = appendReplyFooter(chunk, statusFooter)
		}
		if err := authorizedOutput(ctx, func() error { return sendFn(p, replyCtx, chunk) }); err != nil {
			return false
		}
	}
	return true
}

func appendReplyFooter(content, footer string) string {
	if footer == "" {
		return content
	}
	content = strings.TrimRight(content, "\n")
	last30 := content
	if len(last30) > 30 {
		last30 = last30[len(last30)-30:]
	}
	slog.Debug("appendReplyFooter", "content_len", len(content), "footer", footer, "content_last30", last30)
	if content == "" {
		return "*" + footer + "*"
	}
	return content + "\n\n*" + footer + "*"
}
