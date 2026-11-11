package core

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// admissionQuotaScope checks the requested target even before an idle turn can
// apply its queued switch. It does not mutate a running conversation.
func (e *Engine) admissionQuotaScope(agent Agent, keys ...string) quotaScope {
	if agent == e.agent {
		for i := len(keys) - 1; i >= 0; i-- {
			if keys[i] != "" {
				agent, _ = e.sessionContextForKey(keys[i])
				break
			}
		}
	}
	model := modelOf(agent)
	for _, key := range keys {
		if m := e.sessionModelFor(key); m != "" {
			model = m
		}
	}
	e.modelSwitchMu.Lock()
	for _, key := range keys {
		if p, ok := e.pendingSwitch[key]; ok && p.model != "" {
			model = p.model
		}
	}
	e.modelSwitchMu.Unlock()
	scope := e.quotaScopeFor(agent, model)
	e.capMu.Lock()
	legacy := e.quotaUntil.After(time.Now())
	e.capMu.Unlock()
	if !legacy {
		return scope
	}
	verified := e.quotaVerified(scope.key())
	if verified {
		return scope
	}
	// Migration cannot guess which old model exhausted the role-level record.
	// Only a measured target report can release this target from that record.
	ctx, cancel := context.WithTimeout(e.ctx, 10*time.Second)
	defer cancel()
	var report *UsageReport
	var err error
	if r, ok := agent.(ModelUsageReporter); ok {
		report, err = r.GetUsageForModel(ctx, model)
	} else if r, ok := agent.(UsageReporter); ok && model == modelOf(agent) {
		report, err = r.GetUsage(ctx)
	}
	if err != nil || report == nil {
		return scope
	}
	scope = e.quotaScopeFor(agent, model)
	if report.QuotaGroup != "" {
		scope.Group = report.QuotaGroup
	}
	measured := false
	for _, b := range report.Buckets {
		if report.QuotaGroup != "" && b.QuotaGroup != report.QuotaGroup {
			continue
		}
		if b.LimitReached {
			e.observeQuotaUsageFor(report, "", scope)
			return scope
		}
		for _, w := range b.Windows {
			if w.UsedPercent >= 100 {
				e.observeQuotaUsageFor(report, "", scope)
				return scope
			}
			measured = true
		}
	}
	if measured {
		key := scope.key()
		e.quotaVerifiedMu.Lock()
		if e.quotaState.Verified == nil {
			e.quotaState.Verified = map[string]bool{}
		}
		e.quotaState.Verified[key] = true
		e.quotaVerifiedMu.Unlock()
		e.updateQuotaState(e.saveQuotaLocked)
	}
	return scope
}

// QuotaScopeProvider supplies provider evidence, not a guess based on different
// model IDs. Empty Group means the sharing boundary is unknown: use the whole
// account conservatively. Account must identify the credential source, not a role.
// Account "unknown" means identity resolution failed: retain the provider's
// known cooldowns until an account can be attributed again.
type QuotaScopeProvider interface {
	QuotaScope(model string) (account, group string)
}

// quotaScope is captured before a turn/probe; a later switch must not attribute
// its delayed result to the new provider. Only its digest is persisted.
type quotaScope struct {
	Provider string
	Account  string
	Group    string
}

func (s quotaScope) key() string {
	b, _ := json.Marshal(s)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}

func (e *Engine) quotaScopeFor(agent Agent, model string) quotaScope {
	if agent == nil {
		agent = e.agent
	}
	home, _ := os.UserHomeDir()
	provider := "unconfigured"
	if agent != nil {
		provider = agent.Name()
	}
	s := quotaScope{Provider: provider, Account: home, Group: "account"}
	var parts []string
	if json.Unmarshal([]byte(model), &parts) == nil && len(parts) == 2 {
		s.Provider += "/" + parts[0]
	}
	if resolver, ok := agent.(QuotaScopeProvider); ok {
		account, group := resolver.QuotaScope(model)
		if account != "" {
			s.Account = account
		}
		if group != "" {
			s.Group = group
		}
	}
	if sw, ok := agent.(ProviderSwitcher); ok {
		if p := sw.GetActiveProvider(); p != nil {
			// Provider aliases using the same endpoint/key share the same allowance.
			s.Provider = agent.Name() + "/" + p.BaseURL
			if p.APIKey == "" && p.BaseURL == "" && len(p.Env) == 0 && len(p.CodexHTTPHeaders) == 0 {
				// No credential of its own: the CLI runs on its own login, so the
				// account is whoever is logged in (the resolver above), not this
				// config entry. Hashing the empty entry gave every login the same
				// key, and a new account inherited the old one's cooldown
				// (2026-11-11 用户「我更换了c酱的账号 还是被锁了」).
				return s
			}
			identity, _ := json.Marshal(struct {
				Key     string
				Env     map[string]string
				Headers map[string]string
			}{p.APIKey, p.Env, p.CodexHTTPHeaders})
			s.Account = string(identity)
			// A native-login model pool says nothing about a third-party API key.
			s.Group = "account"
		}
	}
	return s
}

// Multiple conversations/roles can consume one account. Serialize read/merge/
// write in the bridge process so a shorter concurrent deadline cannot win.
var quotaDomainsMu sync.Mutex

func (e *Engine) domainUntilLocked(key string) time.Time {
	until := e.quotaDomains[key]
	if e.dataDir == "" {
		return until
	}
	b, err := os.ReadFile(filepath.Join(e.dataDir, "quota-domains", key+".json"))
	if err == nil {
		var saved time.Time
		if err = json.Unmarshal(b, &saved); err == nil {
			until = saved
		}
	}
	if err != nil && !os.IsNotExist(err) {
		slog.Error("quota domain: read failed", "error", err)
	}
	return until
}

func (e *Engine) saveDomainLocked(key string, until time.Time) {
	if e.quotaDomains == nil {
		e.quotaDomains = map[string]time.Time{}
	}
	e.quotaDomains[key] = until
	if e.dataDir == "" {
		return
	}
	path := filepath.Join(e.dataDir, "quota-domains", key+".json")
	b, err := json.Marshal(until)
	if err == nil {
		err = os.MkdirAll(filepath.Dir(path), 0700)
	}
	if err == nil {
		err = AtomicWriteFile(path, b, 0600)
	}
	if err != nil {
		slog.Error("quota domain: persist failed", "error", err)
	}
}

// quotaCoolingFor answers "is this scope cooling down right now", reading the clock
// itself. A caller that also prints how long is left must use quotaCoolingForAt with
// one instant: checking a few microseconds early and formatting a few microseconds
// late turned a deadline that had just passed into 「大约还要 0s」
// (复核 2026-11-06 观察①：20 万次里 7 次).
func (e *Engine) quotaCoolingFor(scope quotaScope) time.Time {
	return e.quotaCoolingForAt(scope, time.Now())
}

// quotaCoolingForAt is quotaCoolingFor with the clock supplied by the caller, so the
// "is it still cooling" decision and the text derived from it come from one instant.
func (e *Engine) quotaCoolingForAt(scope quotaScope, now time.Time) time.Time {
	if until := e.quotaCoolingDeadlineFor(scope); until.After(now) {
		return until
	}
	return time.Time{}
}

// quotaCoolingDeadlineFor is the single read of "how long is this scope still
// cooling for". It takes the latest of the three records admission has always
// consulted: the exact domain, the provider guard an unresolved identity falls
// back to, and the legacy role-level deadline (exempt for a scope a positive
// probe verified).
//
// Both admission (quotaCoolingForAt) and the takeover hold in quotaTick call it.
// The hold used to read only the first of the three, so it could hand the lead
// back while admission still reported a cooldown: an identity lookup that failed
// leaves this scope's own domain empty, and a peer with a known identity then
// pushes the same pool past this role's deadline, which raises only the guard
// (#269).
//
// It only reads. Refreshing and persisting a caller's own deadline stays with
// that caller, so this stays a query. The caller must not hold quotaDomainsMu,
// quotaVerifiedMu or capMu.
func (e *Engine) quotaCoolingDeadlineFor(scope quotaScope) time.Time {
	quotaDomainsMu.Lock()
	until := e.domainUntilLocked(scope.key())
	if scope.Account == "unknown" {
		// An identity lookup failure is not evidence of a different allowance.
		// This persisted guard also covers a restart with no identity cache.
		guard := quotaScope{Provider: scope.Provider}.key()
		if known := e.domainUntilLocked(guard); known.After(until) {
			until = known
		}
	}
	quotaDomainsMu.Unlock()
	// Old role-only records have no trustworthy model/account attribution.
	// Retain them until expiry; a positive target probe may exempt only its scope.
	exempt := e.quotaVerified(scope.key())
	e.capMu.Lock()
	if !exempt && e.quotaUntil.After(until) {
		until = e.quotaUntil
	}
	e.capMu.Unlock()
	return until
}

// extendDomainLocked keeps both admission views in sync for every extension.
// The caller holds quotaDomainsMu; clearing an exact domain is separate.
func (e *Engine) extendDomainLocked(scope quotaScope, until time.Time) time.Time {
	key := scope.key()
	if old := e.domainUntilLocked(key); old.After(until) {
		until = old
	}
	e.saveDomainLocked(key, until)
	// Only unresolved identities consult this summary. Known independent
	// accounts and pools continue to use their own exact domain above.
	guard := quotaScope{Provider: scope.Provider}.key()
	if old := e.domainUntilLocked(guard); until.After(old) {
		e.saveDomainLocked(guard, until)
	}
	return until
}

func (e *Engine) recordQuotaFor(scope quotaScope, until time.Time, session string) {
	if !until.After(time.Now()) {
		return
	}
	key := scope.key()
	quotaDomainsMu.Lock()
	e.extendDomainLocked(scope, until)
	quotaDomainsMu.Unlock()
	if session != "" {
		session = teamChatKey(session)
	}
	// Admission reads the domain written above. quotaState only drives
	// quotaTick, so it may be applied after quotaTick releases quotaMu.
	e.updateQuotaState(func() {
		// A deferred update can land after a newer one: take the domain's
		// current deadline, which only an exact recovery clears.
		quotaDomainsMu.Lock()
		latest := e.domainUntilLocked(key)
		quotaDomainsMu.Unlock()
		if !latest.After(time.Now()) {
			return
		}
		e.quotaState.Scope = key
		e.quotaState.Until = latest
		e.quotaState.ProbeRound = 0
		e.quotaState.NextProbeAt = time.Time{}
		previous := e.quotaState.ProbeStatus
		e.quotaState.ProbeStatus = "exhausted"
		if session != "" {
			e.quotaState.Session = session
		}
		e.saveQuotaLocked()
		// The recorded status is the log's own subject, not a hidden field: an
		// operator diagnosing a cooldown can tell a provider-reported exhaustion
		// (this path) from a probe that could not measure anything ("unknown")
		// or one that measured a reset ("available"). Only the transition is
		// logged, so repeated exhaustion reports do not repeat the line.
		if previous != e.quotaState.ProbeStatus {
			slog.Info("quota cooldown: provider reported exhaustion",
				"project", e.name, "probe_status", e.quotaState.ProbeStatus, "cooling_until", e.quotaState.Until)
		}
	})
}

// recoverQuotaFor ends scope's cooldown because a real turn under it just got an
// answer. It clears the records admission reads, so the next message is not
// turned away; quotaTick sees those records clear and finishes the recovery
// (lead, notice). A later quota error writes them again, and that wins: there is
// no separate "answered" flag that could outlive it. A scope that was not
// cooling is left untouched.
func (e *Engine) recoverQuotaFor(scope quotaScope) {
	now := time.Now()
	key := scope.key()
	quotaDomainsMu.Lock()
	cooling := false
	if e.domainUntilLocked(key).After(now) {
		e.saveDomainLocked(key, time.Time{})
		cooling = true
	}
	if scope.Account == "unknown" {
		// An unresolved identity is held by the provider guard; the answer
		// came from that same unresolved account, so the guard ends with it.
		guard := quotaScope{Provider: scope.Provider}.key()
		if e.domainUntilLocked(guard).After(now) {
			e.saveDomainLocked(guard, time.Time{})
			cooling = true
		}
	}
	quotaDomainsMu.Unlock()
	e.capMu.Lock()
	legacy := e.quotaUntil.After(now)
	e.capMu.Unlock()
	if legacy && !e.quotaVerified(key) {
		// The role-level record cannot name the account it came from; an
		// answer exempts this scope the same way a positive probe does.
		e.quotaVerifiedMu.Lock()
		if e.quotaState.Verified == nil {
			e.quotaState.Verified = map[string]bool{}
		}
		e.quotaState.Verified[key] = true
		e.quotaVerifiedMu.Unlock()
		cooling = true
	}
	if cooling {
		slog.Info("quota cooldown: provider answered, cooldown cleared", "project", e.name)
	}
}

func (e *Engine) quotaVerified(key string) bool {
	e.quotaVerifiedMu.Lock()
	defer e.quotaVerifiedMu.Unlock()
	return e.quotaState.Verified[key]
}

// updateQuotaState runs fn under quotaMu without waiting for it. The caller may
// hold a task lock that quotaTick (holding quotaMu) is waiting for; blocking here
// deadlocked the bridge on 2026-11-04. When quotaMu is busy, fn runs as soon as
// it is free, in a separate goroutine.
func (e *Engine) updateQuotaState(fn func()) {
	if e.quotaMu.TryLock() {
		defer e.quotaMu.Unlock()
		fn()
		return
	}
	e.quotaUpdates.Add(1)
	go func() {
		defer e.quotaUpdates.Done()
		e.quotaMu.Lock()
		defer e.quotaMu.Unlock()
		fn()
	}()
}

// waitQuotaUpdates blocks until every deferred updateQuotaState write is done.
func (e *Engine) waitQuotaUpdates() { e.quotaUpdates.Wait() }

// The session's effective model includes CLI-pinned and per-channel overrides.
func (e *Engine) quotaScopeOfSession(agent Agent, session AgentSession) quotaScope {
	model := modelOf(agent)
	if getter, ok := session.(interface{ GetModel() string }); ok && getter.GetModel() != "" {
		model = getter.GetModel()
	}
	return e.quotaScopeFor(agent, model)
}
