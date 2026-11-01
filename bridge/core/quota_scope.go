package core

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// QuotaScopeProvider supplies provider evidence, not a guess based on different
// model IDs. Empty Group means the sharing boundary is unknown: use the whole
// account conservatively. Account must identify the credential source, not a role.
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
	s := quotaScope{Provider: agent.Name(), Account: home, Group: "account"}
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
