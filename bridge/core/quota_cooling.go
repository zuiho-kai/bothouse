package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The reset deadline feeds the existing team cooling_until contract. Takeover
// receipts survive restart independently of the agent's conversation.
type quotaCoolingState struct {
	NextProbeAt time.Time                `json:"next_probe_at,omitempty"`
	ProbeStatus string                   `json:"probe_status,omitempty"`
	LegacyUntil time.Time                `json:"legacy_until,omitempty"`
	Scope       string                   `json:"scope,omitempty"`
	Verified    map[string]bool          `json:"verified,omitempty"`
	Until       time.Time                `json:"cooling_until"`
	Session     string                   `json:"session,omitempty"`
	Lead        *quotaLeadTakeover       `json:"lead,omitempty"`
	Transfers   map[string]quotaTransfer `json:"transfers,omitempty"`
	ProbeRound  int                      `json:"probe_round,omitempty"`
}

// quotaProbeBackoffBase: 沿用 capacity_retry.go 冷却退避策略基线
var quotaProbeBackoffBase = 5 * time.Minute

// quotaProbeBackoffMax: 来源 Issue #757 退避上限设定，避免无限制退避
var quotaProbeBackoffMax = 30 * time.Minute

type quotaLeadTakeover struct {
	To    string `json:"to"`
	At    string `json:"at"` // restore only this automatic selection, not a later user choice
	Woken bool   `json:"woken,omitempty"`
}

type quotaTransfer struct {
	To      string    `json:"to"`
	Session string    `json:"session"`
	Title   string    `json:"title"`
	Prompt  string    `json:"prompt"`
	Woken   bool      `json:"woken"`
	Applied bool      `json:"applied"`
	Work    quotaWork `json:"work"`
}

func quotaResetTime(raw string, now time.Time) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if at, err := time.Parse(time.RFC3339, raw); err == nil {
		return at, at.After(now)
	}
	if m := quotaResetDurationRE.FindStringSubmatch(raw); len(m) == 2 {
		d, err := time.ParseDuration(strings.TrimRight(m[1], "."))
		return now.Add(d), err == nil && d > 0
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return now.Add(d), true
	}
	// The structured Claude event carries a provider-local clock and IANA zone.
	loc := now.Location()
	if i := strings.LastIndex(raw, " ("); i >= 0 && strings.HasSuffix(raw, ")") {
		var err error
		loc, err = time.LoadLocation(raw[i+2 : len(raw)-1])
		if err != nil {
			return time.Time{}, false
		}
		raw = raw[:i]
	}
	local := now.In(loc)
	for _, layout := range []string{"Jan 2, 3pm", "Jan 2, 3:04pm", "3pm", "3:04pm", "15:04"} {
		at, err := time.ParseInLocation(layout, raw, loc)
		if err != nil {
			continue
		}
		if strings.HasPrefix(layout, "Jan") {
			at = at.AddDate(local.Year(), 0, 0)
			if !at.After(now) {
				at = at.AddDate(1, 0, 0)
			}
		} else {
			at = time.Date(local.Year(), local.Month(), local.Day(), at.Hour(), at.Minute(), 0, 0, loc)
			if !at.After(now) {
				at = at.AddDate(0, 0, 1)
			}
		}
		return at, true
	}
	return time.Time{}, false
}

func (e *Engine) quotaPath() string {
	return filepath.Join(e.dataDir, "quota-cooling", e.name+".json")
}

func (e *Engine) saveQuotaLocked() {
	if e.dataDir == "" {
		return
	}
	e.capMu.Lock()
	e.quotaState.LegacyUntil = e.quotaUntil
	e.capMu.Unlock()
	e.quotaVerifiedMu.Lock()
	b, err := json.Marshal(e.quotaState)
	e.quotaVerifiedMu.Unlock()
	if err == nil {
		err = os.MkdirAll(filepath.Dir(e.quotaPath()), 0700)
	}
	if err == nil {
		err = AtomicWriteFile(e.quotaPath(), b, 0600)
	}
	if err != nil {
		slog.Error("quota cooldown: persist failed", "project", e.name, "error", err)
	}
}

func (e *Engine) quotaCooling() time.Time {
	return e.quotaCoolingFor(e.quotaScopeFor(e.agent, modelOf(e.agent)))
}

func (e *Engine) recordQuota(until time.Time, session string) {
	e.recordQuotaFor(e.quotaScopeFor(e.agent, modelOf(e.agent)), until, session)
}

func (e *Engine) observeQuotaEvent(ev Event, session string, as AgentSession) {
	e.observeQuotaEventFor(ev, session, as, e.quotaScopeFor(e.agent, modelOf(e.agent)))
}

func (e *Engine) observeQuotaEventFor(ev Event, session string, as AgentSession, scope quotaScope) {
	if scope.Provider == "" {
		scope = e.quotaScopeFor(e.agent, modelOf(e.agent))
	}
	if ev.Type != EventResult && ev.Type != EventError {
		return
	}
	now := time.Now()
	reset, marked := QuotaExhaustedReset(ev)
	var report *UsageReport
	if r, ok := as.(CachedUsageReporter); ok {
		report = r.CachedUsage()
	}
	quotaError := marked
	if ev.Error != nil {
		raw := strings.ToLower(ev.Error.Error())
		quotaError = quotaError || strings.Contains(raw, "quota") || strings.Contains(raw, "resource_exhausted")
	}
	if quotaError && report == nil {
		// Ask the failed session, never the newly selected agent/model.
		if r, ok := as.(UsageReporter); ok && usageReporterAvailable(as) {
			ctx, cancel := context.WithTimeout(e.ctx, 10*time.Second)
			report, _ = r.GetUsage(ctx)
			cancel()
		}
	}
	// Retain the already-read session report with its session-creation scope.
	// The Agent's current provider may have changed while this turn was running.
	e.cacheRoleQuotaReport(e.agent, replyFooterModel(as, e.agent), scope, report)
	if report != nil && report.QuotaGroup != "" {
		scope.Group = report.QuotaGroup
	}
	if failed, _ := ev.Metadata[MetaResultIsError].(bool); ev.Type == EventResult && ev.Done && ev.Error == nil && !failed && !quotaError {
		// Only a successful terminal result proves recovery. A context
		// compaction result is intermediate, even without an error. A usage
		// report still at 100% below records the cooldown again.
		e.recoverQuotaFor(scope)
	}
	if marked {
		if until, ok := quotaResetTime(reset, now); ok {
			e.recordQuotaWindowFor(scope, until, session, "error_reset:"+reset)
		} else {
			slog.Warn("quota cooldown: reset time unavailable", "project", e.name, "reset", reset)
		}
	} else if ev.Error != nil {
		raw := ev.Error.Error()
		lower := strings.ToLower(raw)
		if strings.Contains(lower, "quota") || strings.Contains(lower, "resource_exhausted") {
			if until, ok := quotaResetTime(raw, now); ok {
				e.recordQuotaWindowFor(scope, until, session, "error_text")
			}
		}
	}
	e.observeQuotaUsageFor(report, session, scope)
}

func (e *Engine) observeQuotaUsage(report *UsageReport, session string) {
	e.observeQuotaUsageFor(report, session, e.quotaScopeFor(e.agent, modelOf(e.agent)))
}

func (e *Engine) observeQuotaUsageFor(report *UsageReport, session string, scope quotaScope) {
	if report == nil {
		return
	}
	now := time.Now()
	if report.QuotaGroup != "" {
		scope.Group = report.QuotaGroup
	}
	for _, bucket := range report.Buckets {
		if report.QuotaGroup != "" && bucket.QuotaGroup != report.QuotaGroup {
			continue
		}
		for _, window := range bucket.Windows {
			// Cool down only when the provider says the quota is gone: a limit-reached
			// bucket, a window at 100%, or a reported reset time. A window merely close to
			// its limit still has usable quota, and switching early throws it away.
			// Source: user 2026-10-28 02:4x「或者报错再交接，提前量太多，有点浪费了」.
			if !(bucket.LimitReached || window.UsedPercent >= 100) {
				continue
			}
			until := time.Unix(window.ResetAtUnix, 0)
			if window.ResetAtUnix == 0 && window.ResetAfterSeconds > 0 {
				until = now.Add(time.Duration(window.ResetAfterSeconds) * time.Second)
			}
			if until.After(now) {
				e.recordQuotaWindowFor(scope, until, session, quotaWindowLabel(window))
			}
		}
	}
}

func (e *Engine) loadQuotaCooling() {
	if e.dataDir != "" {
		b, err := os.ReadFile(e.quotaPath())
		if err == nil {
			e.quotaMu.Lock()
			e.quotaVerifiedMu.Lock()
			err = json.Unmarshal(b, &e.quotaState)
			e.quotaVerifiedMu.Unlock()
			if err == nil {
				e.capMu.Lock()
				e.quotaUntil = e.quotaState.LegacyUntil
				if e.quotaState.Scope == "" && e.quotaState.Until.After(e.quotaUntil) {
					e.quotaUntil = e.quotaState.Until
				}
				e.capMu.Unlock()
			}
			e.quotaMu.Unlock()
		}
		if err != nil && !os.IsNotExist(err) {
			slog.Error("quota cooldown: restore failed", "project", e.name, "error", err)
		}
	}
}

func (e *Engine) startQuotaCooling() {
	e.loadQuotaCooling()
	go func() {
		tick := time.NewTicker(teamPollInterval)
		defer tick.Stop()
		for {
			e.quotaTick(time.Now())
			select {
			case <-e.ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
}

// Candidates come from the existing same-channel team binding. No provider or
// model substitution is performed, and a busy/cooling role is never selected. One rule only: a
// free teammate bound to the same channel, first by name. What the task is about does not pick
// the person (the title keywords and role names that used to rank candidates are gone).
func (e *Engine) quotaCandidate(session string, reserved map[string]bool) *Engine {
	rm := e.relayManager
	if rm == nil {
		return nil
	}
	_, chat, err := parseSessionKeyParts(session)
	if err != nil {
		return nil
	}
	// The chat's effective binding: a manual /bind plus the configured team (same
	// team_status_dir). ListBoundBots saw only manual /bind entries, so a team that never ran
	// /bind (no relay_bindings.json) had no candidate and the cooling lead was never replaced.
	plat, _, _ := strings.Cut(session, ":")
	bound := map[string]string{}
	if b := rm.EffectiveBindingFor(plat, chat, e.name); b != nil {
		for k, v := range b.Bots {
			if k != e.name {
				bound[k] = v
			}
		}
	}
	var candidates []*Engine
	for _, peer := range e.watchEngines() {
		if peer == e || reserved[peer.name] || peer.IsPaused() || peer.ctx.Err() != nil ||
			!peer.quotaCoolingFor(peer.admissionQuotaScope(peer.agent, session)).IsZero() || peer.quotaBusyLive(session) {
			continue
		}
		if _, ok := bound[peer.name]; !ok {
			continue
		}
		if peer.lookupReadyPlatform(plat) != nil {
			candidates = append(candidates, peer)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].name < candidates[j].name })
	if len(candidates) == 0 {
		return nil
	}
	return candidates[0]
}

// Workspace tasks and their parent channel share one availability domain.
// Activity in an unrelated chat does not disqualify a teammate here.
func (e *Engine) quotaBusy(session string) bool {
	return e.quotaBusyLive(session) || e.quotaOwnsWorkIn(session)
}

// quotaOwnsWorkIn: an open board item, workspace handoff or task-API relay this role owns
// points at session's chat.
func (e *Engine) quotaOwnsWorkIn(session string) bool {
	here := e.quotaAvailabilityChat(session)
	for _, work := range e.quotaWorkItems() {
		if e.quotaAvailabilityChat(work.Session) == here {
			return true
		}
	}
	return false
}

func (e *Engine) quotaAvailabilityChat(key string) string {
	key = teamChatKey(key)
	if parent, ok := e.WorkspaceParent(key); ok {
		return parent
	}
	return key
}

// quotaBusyLive is "busy" as the lead's 队友状态 shows it: a turn running in session's chat (or
// one of its workspaces), or delegated work there still running. An open board item alone does
// not count: a stale 待办 left on the board (#1243, 鲸鱼娘, 11-08) kept her out of every
// cooldown reassignment in the main channel while the lead's status said 空着 (#1592,
// 2026-11-13 22:39 用户「他冷却你要感知到，然后他换的，你这换个屁」).
func (e *Engine) quotaBusyLive(session string) bool {
	chat := func(key string) string {
		key = teamChatKey(key)
		if parent, ok := e.WorkspaceParent(key); ok {
			return parent
		}
		return key
	}
	here := chat(session)
	managers := []*SessionManager{e.sessions}
	if e.workspacePool != nil {
		for _, ws := range e.workspacePool.All() {
			ws.mu.Lock()
			managers = append(managers, ws.sessions)
			ws.mu.Unlock()
		}
	}
	for _, manager := range managers {
		if manager == nil {
			continue
		}
		for _, key := range manager.UserKeys() {
			if chat(key) != here {
				continue
			}
			for _, s := range manager.ListSessions(key) {
				if s.Busy() {
					return true
				}
			}
		}
	}
	return e.watchDelegatedWork(teamChatKey(session))
}

// quotaSwitchLead moves the primary role to target. lead.json in the data directory is the one
// record of who leads: it is written here in every case, then a configured gate is told as
// well. Before, with a gate configured only the gate was told and the switch counted only if
// lead.json changed afterwards; a gate that keeps its own lead file (an external gate, not the
// bundled one started with BOTHOUSE_DATA_DIR) never changed it, so every takeover failed and
// the gate and the bridge each kept their own lead (2026-10-28: gate said 鲸鱼娘 since 10-21,
// lead.json said 橘 while 橘 was cooling).
func (e *Engine) quotaSwitchLead(target *Engine, now time.Time) (string, error) {
	if err := writeLeadSelectionFile(e.dataDir, target.name, target.DisplayName(), now); err != nil {
		return "", err
	}
	sel, ok := readLeadSelectionFull(e.dataDir)
	if !ok || sel.Lead != target.name {
		return "", fmt.Errorf("quota switch: shared lead selection did not change")
	}
	if e.gate.Load() != nil {
		if err := e.notifyGateLead(target.name); err != nil {
			slog.Warn("quota switch: lead.json written, gate not told", "to", target.name, "error", err)
		}
	}
	target.observeLeadSelection()
	return sel.At, nil
}

// quotaDomainHoldLocked reports whether the role should keep the lead because it
// is still cooling, and refreshes the local deadline when so.
//
// The deadline that justifies a takeover is a property of the pool, not of this
// role: another role can report exhaustion and push the same pool past this
// role's own deadline just as that one expires. Handing the lead back then would
// return it to a role that is still exhausted (#267), so every expiry path asks
// here first, and follows the shared deadline instead of its stale local copy.
//
// scope is the one quotaTick already resolved for this role, and "still cooling"
// is read through quotaCoolingDeadlineFor, the same function admission uses, so
// the hold cannot answer differently from admission. Reading only the exact
// domain here was wrong in the one case where that domain is empty while
// admission still cools: an unresolved identity falls back to the provider
// guard, and the legacy deadline can also outlive the state's own record (#269).
// A state with no scope still has those two records to consult, so there is no
// early return; when all of them have expired it unwinds exactly as before. The
// caller holds quotaMu.
func (e *Engine) quotaDomainHoldLocked(now time.Time, scope quotaScope) bool {
	st := &e.quotaState
	until := e.quotaCoolingDeadlineFor(scope)
	if !until.After(now) {
		return false
	}
	if !st.Until.Equal(until) {
		st.Until = until
		e.saveQuotaLocked()
	}
	return true
}

// quotaUnwindLeadLocked gives the primary role back when the cooldown deadline
// that justified taking it has passed. The caller holds quotaMu. Only the shared
// selection this takeover wrote is restored (same target, same timestamp), so a
// later human or role choice always survives. restored reports whether this call
// actually switched the shared lead back; ok reports whether the caller should
// carry on — a failed switch aborts the tick, because a probe result must not be
// recorded while the stand-in is left behind.
//
// Nothing is announced here. The deadline passing is not evidence the quota is
// back — a probe still has to agree — so there is no MsgQuotaLeadRestored and no
// quota_restored event. The success path announces it after its own probe; the
// expiry paths stay silent, matching the no-reporter branch.
func (e *Engine) quotaUnwindLeadLocked(now time.Time) (restored, ok bool) {
	st := &e.quotaState
	if st.Lead == nil {
		return false, true
	}
	sel, found := readLeadSelectionFull(e.dataDir)
	if !found {
		// A fresh or unreadable lead.json holds no shared choice to compare
		// against; drop the local handoff without claiming a restore.
		st.Lead = nil
		e.saveQuotaLocked()
		return false, true
	}
	if sel.Lead != st.Lead.To || sel.At != st.Lead.At {
		// Someone else owns the lead now; forget only our stale handoff.
		st.Lead = nil
		e.saveQuotaLocked()
		return false, true
	}
	if _, err := e.quotaSwitchLead(e, now); err != nil {
		slog.Warn("quota expiry: lead restore failed", "project", e.name, "error", err)
		return false, false
	}
	st.Lead = nil
	e.saveQuotaLocked()
	return true, true
}

// notifyGateLead tells the gate (POST /lead set) who leads now, for a gate that keeps its own
// copy. The bundled gate reads lead.json itself; telling it again is harmless.
func (e *Engine) notifyGateLead(who string) error {
	g := e.gate.Load()
	if g == nil {
		return nil
	}
	u, err := url.Parse(g.liveURL())
	if err != nil {
		return err
	}
	u.Path, u.RawQuery = "/lead", ""
	body, _ := json.Marshal(map[string]string{"action": "set", "who": who})
	ctx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("quota switch gate: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		OK bool `json:"ok"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&out); err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK || !out.OK {
		return fmt.Errorf("quota switch gate: HTTP %d", resp.StatusCode)
	}
	return nil
}

// probeQuota performs a silent low-overhead quota probe without waking the conversation model.
func (e *Engine) probeQuota(ctx context.Context) (bool, time.Duration, error) {
	if e.quotaProbeFn != nil {
		return e.quotaProbeFn(ctx)
	}
	reporter, ok := e.agent.(UsageReporter)
	if !ok || !usageReporterAvailable(e.agent) {
		return false, 0, fmt.Errorf("quota availability unknown")
	}
	fetchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	model := modelOf(e.agent)
	scope := e.quotaScopeFor(e.agent, model)
	var report *UsageReport
	var err error
	if r, ok := e.agent.(ModelUsageReporter); ok {
		report, err = r.GetUsageForModel(fetchCtx, model)
	} else {
		report, err = reporter.GetUsage(fetchCtx)
	}
	if modelOf(e.agent) != model || e.quotaScopeFor(e.agent, model) != scope {
		return false, 0, fmt.Errorf("quota target changed during probe")
	}
	if err != nil {
		return false, 0, err
	}
	if report == nil {
		return false, 0, fmt.Errorf("quota availability unknown")
	}
	now := time.Now()
	measured := false
	for _, bucket := range report.Buckets {
		if report.QuotaGroup != "" && bucket.QuotaGroup != report.QuotaGroup {
			continue
		}
		if bucket.LimitReached && len(bucket.Windows) == 0 {
			return false, 0, nil
		}
		for _, window := range bucket.Windows {
			measured = true
			if bucket.LimitReached || window.UsedPercent >= 100 {
				until := time.Unix(window.ResetAtUnix, 0)
				if window.ResetAtUnix == 0 && window.ResetAfterSeconds > 0 {
					until = now.Add(time.Duration(window.ResetAfterSeconds) * time.Second)
				}
				if until.After(now) {
					return false, time.Until(until), nil
				}
				return false, 0, nil
			}
		}
	}
	if !measured {
		return false, 0, fmt.Errorf("quota availability unknown")
	}
	return true, 0, nil
}

func (e *Engine) quotaTick(now time.Time) {
	rm := e.relayManager
	if rm == nil {
		return
	}
	currentUntil := e.quotaCooling()
	rm.quotaMu.Lock()
	defer rm.quotaMu.Unlock()
	e.quotaMu.Lock()
	defer e.quotaMu.Unlock()
	st := &e.quotaState
	scope := e.quotaScopeFor(e.agent, modelOf(e.agent))
	// A new target cannot recover or take over work for an old quota pool.
	if st.Scope != "" && st.Scope != scope.key() {
		if currentUntil.IsZero() && st.Lead != nil {
			sel, ok := readLeadSelectionFull(e.dataDir)
			if ok && sel.Lead == st.Lead.To && sel.At == st.Lead.At {
				if _, err := e.quotaSwitchLead(e, now); err != nil {
					slog.Warn("quota switch: lead restore failed", "error", err)
					return
				}
				e.quotaNotice(st.Session, e.i18n.Tf(MsgQuotaLeadRestored, e.DisplayName()))
			}
			st.Lead = nil
			e.saveQuotaLocked()
		}
		return
	}
	if st.Until.After(now) && !e.quotaCoolingDeadlineFor(scope).After(now) {
		// The deadline is still ahead but nothing admission reads holds it any
		// more: an answered turn cleared the records (recoverQuotaFor). The
		// records are the single truth, so a quota error recorded after that
		// answer, here or by another role on the same pool, keeps this branch
		// shut (review of #1637). Finish what a successful probe finishes.
		e.quotaRestoredLocked(now, "quota recovered: turn answered")
		return
	}
	if st.Until.IsZero() {
		return
	}
	if !st.Until.After(now) {
		if _, reportsUsage := e.agent.(UsageReporter); e.quotaProbeFn == nil && (!reportsUsage || !usageReporterAvailable(e.agent)) {
			// No query capability is not a failed query. Let the provider's
			// recorded deadline expire without inventing another exhausted window
			// or announcing recovery. A future real turn supplies new evidence.
			//
			// The deadline passing still ends the takeover's own premise, so the
			// automatic lead handoff it caused is unwound here: only the shared
			// selection this engine wrote is restored, and nothing is announced
			// (no MsgQuotaLeadRestored, no quota_restored event) because the quota
			// itself stays unproven.
			//
			// Only this role's deadline has passed though. If another role
			// pushed the shared pool's deadline past now, the premise is not
			// gone after all: keep the takeover and follow that deadline.
			if e.quotaDomainHoldLocked(now, scope) {
				return
			}
			e.quotaUnwindLeadLocked(now)
			return
		}
		// The retry gate below is local pacing, not part of the takeover's own
		// premise. A retry time this code cannot have written (a corrupt or
		// legacy record, or a wall clock that stepped back after it was saved)
		// returned here forever: the provider deadline had passed but the
		// recovery/rollback path never ran, so the lead stayed with the
		// stand-in (#190). Every retry this code schedules is at most
		// quotaProbeBackoffMax past a deadline that may already have passed, so
		// anything later than that is treated as no retry scheduled and the
		// probe runs now.
		if st.NextProbeAt.After(now.Add(quotaProbeBackoffMax)) {
			slog.Warn("quota auto-probe: retry time unreachable, probing now",
				"project", e.name, "next_probe_at", st.NextProbeAt)
			st.NextProbeAt = time.Time{}
			e.saveQuotaLocked()
		}
		if st.NextProbeAt.After(now) {
			// A backoff this code did schedule still defers the probe, but it
			// does not defer the unwind: the deadline that justified the
			// takeover has passed, so the stand-in goes back now instead of
			// holding the role through up to quotaProbeBackoffMax.
			//
			// Unless the shared pool is still cooling: another role can have
			// extended the same domain after this role's deadline, and unwinding
			// then hands the lead to a role that is still exhausted (#267).
			if e.quotaDomainHoldLocked(now, scope) {
				return
			}
			e.quotaUnwindLeadLocked(now)
			return
		}
		quotaDomainsMu.Lock()
		observedUntil := e.domainUntilLocked(st.Scope)
		quotaDomainsMu.Unlock()
		if st.Scope != "" && observedUntil.After(now) {
			st.Until = observedUntil
			e.saveQuotaLocked()
			return
		}
		usable, nextWait, err := e.probeQuota(e.ctx)
		// Another role can report exhaustion while this network probe runs.
		// Its newer deadline wins over both recovery and probe backoff.
		quotaDomainsMu.Lock()
		if st.Scope != "" {
			latest := e.domainUntilLocked(st.Scope)
			if !latest.Equal(observedUntil) {
				quotaDomainsMu.Unlock()
				st.Until = latest
				e.saveQuotaLocked()
				return
			}
		}
		if !usable || err != nil {
			// Retry timing is local policy, separate from the provider deadline.
			st.ProbeRound++
			backoff := quotaProbeBackoffBase
			for i := 1; i < st.ProbeRound && backoff < quotaProbeBackoffMax; i++ {
				backoff *= 2
			}
			if backoff > quotaProbeBackoffMax {
				backoff = quotaProbeBackoffMax
			}
			if nextWait > backoff {
				backoff = nextWait
			}
			st.NextProbeAt = now.Add(backoff)
			if err != nil {
				quotaDomainsMu.Unlock()
				st.ProbeStatus = "unknown"
				e.saveQuotaLocked()
				slog.Warn("quota auto-probe: usage unknown, probe backed off",
					"project", e.name, "probe_status", st.ProbeStatus, "next_probe_at", st.NextProbeAt, "err", err)
				// Nothing was measured, so the deadline stays expired and the
				// takeover has no premise left. Give the role back now instead
				// of after the backoff; if the provider is still exhausted, the
				// next real turn records a fresh deadline and takes over from
				// that evidence.
				//
				// The shared domain needs no second look here: it was read just
				// before the probe and returned above when it still cooled, and
				// any change during the probe returned above too, so the pool is
				// expired at this point (#267).
				e.quotaUnwindLeadLocked(now)
				return
			}
			st.ProbeStatus = "exhausted"
			// Preserve the existing bounded fallback only for confirmed exhaustion
			// with no provider reset. An actual reset must not be rounded up.
			st.Until = now.Add(backoff)
			if nextWait > 0 {
				st.Until = now.Add(nextWait)
			}
			e.capMu.Lock()
			if st.Scope == "" {
				e.quotaUntil = st.Until
			}
			e.capMu.Unlock()
			if st.Scope != "" {
				st.Until = e.extendDomainLocked(scope, st.Until)
			}
			quotaDomainsMu.Unlock()
			e.saveQuotaLocked()
			slog.Warn("quota auto-probe: quota still exhausted, cooling extended",
				"project", e.name, "until", st.Until, "round", st.ProbeRound, "probe_status", st.ProbeStatus, "err", err)
			return
		}

		// 探活成功：自动解除冷却状态，记录恢复事件
		if st.Scope != "" {
			e.saveDomainLocked(st.Scope, time.Time{})
		}
		quotaDomainsMu.Unlock()
		e.quotaRestoredLocked(now, "quota auto-probe: restored")
		return
	}
	if st.Transfers == nil {
		st.Transfers = map[string]quotaTransfer{}
	}
	session := st.Session
	if session == "" {
		chats := e.teamLeadChats()
		if len(chats) > 0 {
			session = chats[0]
			st.Session = session
		}
	}
	if e.isTeamLead() && st.Lead == nil && session != "" {
		if target := e.quotaCandidate(session, nil); target != nil {
			at, err := e.quotaSwitchLead(target, now)
			if err != nil {
				slog.Warn("quota takeover: lead switch failed", "project", e.name, "error", err)
			} else {
				st.Lead = &quotaLeadTakeover{To: target.name, At: at}
				e.saveQuotaLocked()
				e.quotaNotice(session, e.i18n.Tf(MsgQuotaLeadTakeover, e.DisplayName(), target.DisplayName()))
			}
		}
	}
	if st.Lead != nil && !st.Lead.Woken {
		for _, target := range e.watchEngines() {
			if target.name == st.Lead.To {
				if err := e.queueQuotaWake(target, "lead", session, target.i18n.Tf(MsgQuotaLeadPrompt, e.DisplayName()), "quota lead takeover"); err == nil {
					st.Lead.Woken = true
					e.saveQuotaLocked()
				} else {
					slog.Warn("quota takeover: lead wake failed", "error", err)
				}
			}
		}
	}
	e.quotaTransferWork(st, now)
}

// quotaRestoredLocked ends the cooldown in quotaState once the domain is clear:
// gives back the lead a takeover took and announces the recovery. It reports
// false when the lead could not be restored; the state is kept so the next tick
// retries. The caller holds quotaMu (and relayManager.quotaMu, as quotaTick).
func (e *Engine) quotaRestoredLocked(now time.Time, event string) bool {
	st := &e.quotaState
	st.ProbeRound = 0
	st.NextProbeAt = time.Time{}
	st.ProbeStatus = "available"
	if restored, ok := e.quotaUnwindLeadLocked(now); !ok {
		return false
	} else if restored {
		e.quotaNotice(st.Session, e.i18n.Tf(MsgQuotaLeadRestored, e.DisplayName()))
	}
	st.Until, st.Lead = time.Time{}, nil
	e.capMu.Lock()
	if st.Scope == "" {
		e.quotaUntil = time.Time{}
	}
	e.capMu.Unlock()
	e.saveQuotaLocked()
	slog.Info("quota cooldown: quota restored", "project", e.name, "probe_status", st.ProbeStatus, "via", event)
	e.emitStreamEvent(StreamEventQuota, st.Session, event, map[string]any{"project": e.name, "action": "quota_restored"})
	return true
}

func (e *Engine) quotaNotice(session, text string) {
	plat, _, _ := strings.Cut(session, ":")
	p := e.lookupReadyPlatform(plat)
	if p == nil {
		slog.Warn("quota takeover: notification platform unavailable", "session", session)
		return
	}
	if err := newHandoffWatch(e).send(p, session, text); err != nil {
		slog.Warn("quota takeover: notification failed", "session", session, "error", err)
	}
}
