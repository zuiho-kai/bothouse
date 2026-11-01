package core

// Issue #751: routing and contextual relevance are not execution authority.
// This module stores local decisions. It never launches an agent or sends a message.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

type ProactiveMode string

const (
	ProactiveOff     ProactiveMode = "off"
	ProactiveObserve ProactiveMode = "observe"
	ProactiveAuto    ProactiveMode = "auto"
)

// AuthorityIdentity is a platform-qualified stable account ID, never a nickname.
// Multiple identities belong to one principal only when explicitly bound.
type AuthorityIdentity struct {
	Platform string `json:"platform"`
	UserID   string `json:"user_id"`
}
type AuthorityBinding struct {
	Principal  string              `json:"principal"`
	Identities []AuthorityIdentity `json:"identities"`
}
type ProactiveRule struct {
	ID         string   `json:"id"`
	Source     string   `json:"source"`
	Principal  string   `json:"principal"`
	SessionKey string   `json:"session_key"`
	EventKind  string   `json:"event_kind"`
	Scopes     []string `json:"scopes"`
}
type ProactivePolicy struct {
	Version   uint64             `json:"version"`
	Mode      ProactiveMode      `json:"mode"`
	Authority string             `json:"authority"`
	Bindings  []AuthorityBinding `json:"bindings"`
	Rules     []ProactiveRule    `json:"rules"`
}

// Constructed by trusted ingress after source authentication and visibility checks.
// Attestations cannot be supplied in JSON. Mentions are not authorization.
type ProactiveCandidate struct {
	EventID       string            `json:"event_id"`
	Source        string            `json:"source"`
	EventKind     string            `json:"event_kind"`
	Identity      AuthorityIdentity `json:"identity"`
	SessionKey    string            `json:"session_key"`
	Scopes        []string          `json:"scopes"`
	ActorKind     string            `json:"actor_kind"`
	Intent        string            `json:"intent"`
	Authenticated bool              `json:"-"`
	Visible       bool              `json:"-"`
	ContextOnly   bool              `json:"-"`
}
type AuthorizationDecision struct {
	ID            string            `json:"id"`
	EventID       string            `json:"event_id"`
	Source        string            `json:"source"`
	EventKind     string            `json:"event_kind"`
	Identity      AuthorityIdentity `json:"identity"`
	Principal     string            `json:"principal,omitempty"`
	SessionKey    string            `json:"session_key"`
	Intent        string            `json:"intent"`
	Authority     string            `json:"authority,omitempty"`
	PolicyVersion uint64            `json:"policy_version"`
	RuleID        string            `json:"rule_id,omitempty"`
	Scopes        []string          `json:"scopes,omitempty"`
	Outcome       string            `json:"outcome"`
	Reason        string            `json:"reason"`
	CreatedAt     time.Time         `json:"created_at"`
}

// Assignment is distinct from identity: changing backend cannot change authority.
type AuthorizationAssignment struct {
	DecisionID string    `json:"decision_id"`
	TaskID     string    `json:"task_id"`
	Role       string    `json:"role"`
	Backend    string    `json:"backend"`
	SessionKey string    `json:"session_key"`
	At         time.Time `json:"at"`
}
type AuthorizationNotice struct {
	DecisionID    string    `json:"decision_id"`
	TaskID        string    `json:"task_id"`
	Reason        string    `json:"reason"`
	PolicyVersion uint64    `json:"policy_version"`
	At            time.Time `json:"at"`
}
type AuthorizationEffect struct {
	ID         string     `json:"id"`
	DecisionID string     `json:"decision_id"`
	Scope      string     `json:"scope"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	Result     string     `json:"result,omitempty"`
}
type authorizationState struct {
	Policy      ProactivePolicy                  `json:"policy"`
	Decisions   map[string]AuthorizationDecision `json:"decisions"`
	Admitted    map[string]string                `json:"admitted"`
	Assignments []AuthorizationAssignment        `json:"assignments"`
	Revoked     map[string]string                `json:"revoked"`
	Notices     []AuthorizationNotice            `json:"notices"`
	Renewals    []AuthorizationRenewal           `json:"renewals,omitempty"`
	Effects     map[string]AuthorizationEffect   `json:"effects"`
}
type ProactiveAuthorization struct {
	invalidations map[chan struct{}]string
	mu            sync.Mutex
	path          string
	state         authorizationState
}

var ErrAuthorizationDenied = errors.New("authorization denied")
var ErrAuthorizationStale = errors.New("authorization policy changed")
var ErrAuthorizationDuplicate = errors.New("source event already admitted")

func OpenProactiveAuthorization(path string) (*ProactiveAuthorization, error) {
	a := &ProactiveAuthorization{path: path, state: authorizationState{Policy: ProactivePolicy{Mode: ProactiveOff}, Decisions: map[string]AuthorizationDecision{}, Admitted: map[string]string{}, Revoked: map[string]string{}, Effects: map[string]AuthorizationEffect{}}}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return a, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read authorization: %w", err)
	}
	if err = json.Unmarshal(b, &a.state); err != nil {
		return nil, fmt.Errorf("decode authorization: %w", err)
	}
	if a.state.Policy.Version != 0 {
		if err = validateProactivePolicy(a.state.Policy); err != nil {
			return nil, fmt.Errorf("load authorization: %w", err)
		}
	}
	if a.state.Decisions == nil || a.state.Admitted == nil || a.state.Revoked == nil || a.state.Effects == nil {
		return nil, errors.New("incomplete authorization journal")
	}
	return a, nil
}

// These are derived context, never an origin that can attest human authority.
func contextualAuthorizationSource(source string) bool {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "wiki", "gate", "context", "context_subscription", "context-only":
		return true
	}
	return false
}
func validateProactivePolicy(p ProactivePolicy) error {
	if p.Mode != ProactiveOff && p.Mode != ProactiveObserve && p.Mode != ProactiveAuto {
		return errors.New("invalid proactive mode")
	}
	if p.Authority == "" {
		return errors.New("policy authority required")
	}
	principals := map[string]bool{}
	identities := map[AuthorityIdentity]bool{}
	for _, b := range p.Bindings {
		if b.Principal == "" || principals[b.Principal] || len(b.Identities) == 0 {
			return errors.New("invalid or duplicate principal")
		}
		principals[b.Principal] = true
		for _, id := range b.Identities {
			if id.Platform == "" || id.UserID == "" || identities[id] {
				return errors.New("invalid or ambiguous identity binding")
			}
			identities[id] = true
		}
	}
	rules := map[string]bool{}
	for _, r := range p.Rules {
		if r.ID == "" || rules[r.ID] || r.Source == "" || contextualAuthorizationSource(r.Source) || r.SessionKey == "" || r.EventKind == "" || !principals[r.Principal] || len(r.Scopes) == 0 {
			return errors.New("rule requires unique ID, source, bound principal, session, event kind and scopes")
		}
		rules[r.ID] = true
		for _, s := range r.Scopes {
			if s == "" || s == "*" {
				return errors.New("explicit non-wildcard scope required")
			}
		}
	}
	return nil
}

// Persist first: a failed disk write never enables an in-memory grant.
func (a *ProactiveAuthorization) transaction(change func(*authorizationState) error) error {
	b, err := json.Marshal(a.state)
	if err != nil {
		return err
	}
	var next authorizationState
	if err = json.Unmarshal(b, &next); err != nil {
		return err
	}
	if err = change(&next); err != nil {
		return err
	}
	b, err = json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(a.path), 0700); err != nil {
		return err
	}
	if err = AtomicWriteFile(a.path, b, 0600); err != nil {
		return err
	}
	// Detach caller-owned slices before exposing the committed state.
	if err = json.Unmarshal(b, &a.state); err != nil {
		return err
	}
	return nil
}
func (a *ProactiveAuthorization) Snapshot() ([]byte, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return json.Marshal(a.state)
}
func (a *ProactiveAuthorization) Policy() ProactivePolicy {
	a.mu.Lock()
	defer a.mu.Unlock()
	b, _ := json.Marshal(a.state.Policy)
	var p ProactivePolicy
	_ = json.Unmarshal(b, &p)
	return p
}

// Optimistic version checks invalidate evaluations in progress. Accepted tasks
// receive durable local notices; notification content contains no private inputs.
func (a *ProactiveAuthorization) ReplacePolicy(expected uint64, p ProactivePolicy) error {
	if err := validateProactivePolicy(p); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.state.Policy.Version != expected {
		return ErrAuthorizationStale
	}
	p.Version = expected + 1
	err := a.transaction(func(s *authorizationState) error {
		s.Policy = p
		seen := map[string]bool{}
		for _, as := range s.Assignments {
			if !seen[as.TaskID] {
				s.Notices = append(s.Notices, AuthorizationNotice{as.DecisionID, as.TaskID, "policy_changed", p.Version, time.Now().UTC()})
				seen[as.TaskID] = true
			}
		}
		return nil
	})
	if err == nil {
		a.invalidateLocked("")
	}
	return err
}
func authorizationEventKey(source, event string) string {
	b, _ := json.Marshal([]string{source, event})
	return string(b)
}
func (a *ProactiveAuthorization) Evaluate(c ProactiveCandidate) (AuthorizationDecision, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.evaluateLocked(c)
}
func (a *ProactiveAuthorization) evaluateLocked(c ProactiveCandidate) (AuthorizationDecision, error) {
	p := a.state.Policy
	d := AuthorizationDecision{EventID: c.EventID, Source: c.Source, EventKind: c.EventKind, Identity: c.Identity, SessionKey: c.SessionKey, Intent: c.Intent, PolicyVersion: p.Version, Outcome: "denied", Reason: "untrusted_candidate", CreatedAt: time.Now().UTC()}
	switch {
	case c.EventID == "" || c.Source == "" || contextualAuthorizationSource(c.Source) || !c.Authenticated || !c.Visible || c.ContextOnly || c.ActorKind != "human" || c.Identity.Platform == "" || c.Identity.UserID == "":
	case c.Intent == "explicit":
		d.Outcome = "explicit_path"
		d.Reason = "existing_permission_checks_required"
	case c.Intent != "inferred":
		d.Reason = "invalid_intent"
	case p.Mode == ProactiveOff:
		d.Outcome = "off"
		d.Reason = "proactive_disabled"
	default:
		for _, b := range p.Bindings {
			if slices.Contains(b.Identities, c.Identity) {
				d.Principal = b.Principal
				break
			}
		}
		d.Reason = "no_matching_rule"
		for _, r := range p.Rules {
			if r.Source != c.Source || r.Principal != d.Principal || r.SessionKey != c.SessionKey || r.EventKind != c.EventKind || len(c.Scopes) == 0 {
				continue
			}
			allowed := true
			for _, scope := range c.Scopes {
				if !slices.Contains(r.Scopes, scope) {
					allowed = false
				}
			}
			if !allowed {
				continue
			}
			d.Authority = p.Authority
			d.RuleID = r.ID
			d.Scopes = slices.Clone(c.Scopes)
			d.Outcome = "would_accept"
			d.Reason = "matched_rule"
			if p.Mode == ProactiveAuto {
				d.Outcome = "eligible"
			}
			break
		}
	}
	// Include attestations so an untrusted duplicate cannot poison a genuine event.
	key, _ := json.Marshal(struct {
		Candidate                 ProactiveCandidate
		Version                   uint64
		Trusted, Visible, Context bool
	}{c, p.Version, c.Authenticated, c.Visible, c.ContextOnly})
	sum := sha256.Sum256(key)
	d.ID = "decision-" + hex.EncodeToString(sum[:])
	if old, ok := a.state.Decisions[d.ID]; ok {
		old.Scopes = slices.Clone(old.Scopes)
		return old, nil
	}
	err := a.transaction(func(s *authorizationState) error { s.Decisions[d.ID] = d; return nil })
	return d, err
}
func (a *ProactiveAuthorization) checkLocked(id, scope string, admitted bool) error {
	d, ok := a.state.Decisions[id]
	if !ok || d.Outcome != "eligible" || a.state.Revoked[id] != "" {
		return ErrAuthorizationDenied
	}
	if d.PolicyVersion != a.state.Policy.Version || a.state.Policy.Mode != ProactiveAuto {
		return ErrAuthorizationStale
	}
	if scope != "" && !slices.Contains(d.Scopes, scope) {
		return ErrAuthorizationDenied
	}
	if admitted && a.state.Admitted[authorizationEventKey(d.Source, d.EventID)] != id {
		return ErrAuthorizationDenied
	}
	return nil
}
func (a *ProactiveAuthorization) Check(id, scope string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.checkLocked(id, scope, true)
}
func (a *ProactiveAuthorization) Admit(id, taskID, role, backend, session string) error {
	if taskID == "" || role == "" || backend == "" || session == "" {
		return errors.New("task assignment required")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.checkLocked(id, "", false); err != nil {
		return err
	}
	d := a.state.Decisions[id]
	if session != d.SessionKey {
		return ErrAuthorizationDenied
	}
	key := authorizationEventKey(d.Source, d.EventID)
	if existing := a.state.Admitted[key]; existing != "" {
		for _, as := range a.state.Assignments {
			if existing == id && as.DecisionID == id && as.TaskID == taskID && as.Role == role && as.Backend == backend && as.SessionKey == session {
				return nil
			}
		}
		return ErrAuthorizationDuplicate
	}
	return a.transaction(func(s *authorizationState) error {
		s.Admitted[key] = id
		s.Assignments = append(s.Assignments, AuthorizationAssignment{id, taskID, role, backend, session, time.Now().UTC()})
		return nil
	})
}

// Reassign is also the resume boundary. Stopped decisions never revive merely
// because the backend or execution workspace changes.
func (a *ProactiveAuthorization) Reassign(id, taskID, role, backend, session string) error {
	if taskID == "" || role == "" || backend == "" || session == "" {
		return errors.New("task assignment required")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.checkLocked(id, "", true); err != nil {
		return err
	}
	if session != a.state.Decisions[id].SessionKey {
		return ErrAuthorizationDenied
	}
	found := false
	for i := len(a.state.Assignments) - 1; i >= 0; i-- {
		as := a.state.Assignments[i]
		if as.DecisionID == id && as.TaskID == taskID {
			if as.Role == role && as.Backend == backend && as.SessionKey == session {
				return nil
			}
			found = true
			break
		}
	}
	if !found {
		return ErrAuthorizationDenied
	}
	return a.transaction(func(s *authorizationState) error {
		s.Assignments = append(s.Assignments, AuthorizationAssignment{id, taskID, role, backend, session, time.Now().UTC()})
		return nil
	})
}
func (a *ProactiveAuthorization) Revoke(id, authority string) error {
	if authority == "" {
		return errors.New("withdrawal authority required")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.state.Decisions[id]; !ok {
		return ErrAuthorizationDenied
	}
	if a.state.Revoked[id] != "" {
		return nil
	}
	err := a.transaction(func(s *authorizationState) error {
		s.Revoked[id] = authority
		seen := map[string]bool{}
		for _, as := range s.Assignments {
			if as.DecisionID == id && !seen[as.TaskID] {
				s.Notices = append(s.Notices, AuthorizationNotice{id, as.TaskID, "withdrawn", s.Policy.Version, time.Now().UTC()})
				seen[as.TaskID] = true
			}
		}
		return nil
	})
	if err == nil {
		a.invalidateLocked(id)
	}
	return err
}

// Check immediately before a controlled effect. Durable effect IDs prohibit
// repeating an uncertain in-flight operation. This is not an OS sandbox.
func (a *ProactiveAuthorization) BeginEffect(id, scope, effectID string) error {
	if scope == "" || effectID == "" {
		return errors.New("scope and effect ID required")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.checkLocked(id, scope, true); err != nil {
		return err
	}
	if _, ok := a.state.Effects[effectID]; ok {
		return ErrAuthorizationDuplicate
	}
	return a.transaction(func(s *authorizationState) error {
		s.Effects[effectID] = AuthorizationEffect{ID: effectID, DecisionID: id, Scope: scope, StartedAt: time.Now().UTC()}
		return nil
	})
}
func (a *ProactiveAuthorization) FinishEffect(effectID, result string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	effect, ok := a.state.Effects[effectID]
	if !ok {
		return errors.New("unknown effect")
	}
	if effect.FinishedAt != nil {
		if effect.Result == result {
			return nil
		}
		return errors.New("effect already finished")
	}
	return a.transaction(func(s *authorizationState) error {
		now := time.Now().UTC()
		effect.FinishedAt = &now
		effect.Result = result
		s.Effects[effectID] = effect
		return nil
	})
}

// Watch subscribes without a check/subscribe race. Closing a subscription signals
// a committed withdrawal or policy revision, not successful rollback of effects.
func (a *ProactiveAuthorization) Watch(id string) (<-chan struct{}, func(), error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.checkLocked(id, "", true); err != nil {
		return nil, nil, err
	}
	if a.invalidations == nil {
		a.invalidations = map[chan struct{}]string{}
	}
	ch := make(chan struct{})
	a.invalidations[ch] = id
	return ch, func() { a.mu.Lock(); delete(a.invalidations, ch); a.mu.Unlock() }, nil
}
func (a *ProactiveAuthorization) invalidateLocked(id string) {
	for ch, decision := range a.invalidations {
		if id == "" || decision == id {
			close(ch)
			delete(a.invalidations, ch)
		}
	}
}
