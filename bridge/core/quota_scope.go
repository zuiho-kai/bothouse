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
	e.quotaMu.Lock()
	verified := e.quotaState.Verified[scope.key()]
	e.quotaMu.Unlock()
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
		e.quotaMu.Lock()
		if e.quotaState.Verified == nil {
			e.quotaState.Verified = map[string]bool{}
		}
		e.quotaState.Verified[scope.key()] = true
		e.saveQuotaLocked()
		e.quotaMu.Unlock()
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

func (e *Engine) quotaCoolingFor(scope quotaScope) time.Time {
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
	e.quotaMu.Lock()
	exempt := e.quotaState.Verified[scope.key()]
	e.quotaMu.Unlock()
	e.capMu.Lock()
	if !exempt && e.quotaUntil.After(until) {
		until = e.quotaUntil
	}
	e.capMu.Unlock()
	if until.After(time.Now()) {
		return until
	}
	return time.Time{}
}

func (e *Engine) recordQuotaFor(scope quotaScope, until time.Time, session string) {
	if !until.After(time.Now()) {
		return
	}
	key := scope.key()
	quotaDomainsMu.Lock()
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
	quotaDomainsMu.Unlock()
	e.quotaMu.Lock()
	defer e.quotaMu.Unlock()
	e.quotaState.Scope = key
	e.quotaState.Until = until
	e.quotaState.ProbeRound = 0
	if session != "" {
		e.quotaState.Session = teamChatKey(session)
	}
	e.saveQuotaLocked()
}

// The session's effective model includes CLI-pinned and per-channel overrides.
func (e *Engine) quotaScopeOfSession(agent Agent, session AgentSession) quotaScope {
	model := modelOf(agent)
	if getter, ok := session.(interface{ GetModel() string }); ok && getter.GetModel() != "" {
		model = getter.GetModel()
	}
	return e.quotaScopeFor(agent, model)
}
