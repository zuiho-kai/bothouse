package core

import (
	"context"
	"encoding/json"
	"fmt"
)

// sessionModelSelection is independent of the native conversation ID: /new and
// process reconstruction retain the channel's selection. Directory defaults and
// configured session_models remain fallbacks for channels without a selection.
type sessionModelSelection struct {
	Model  string `json:"model,omitempty"`
	Effort string `json:"effort,omitempty"`
}

type sessionSettingsContextKey struct{}

// WithSessionSettings carries immutable settings to a single session startup.
// Adapters resolve these after their provider defaults, without mutating the
// shared Agent. Native compaction also accepts SessionSettings explicitly.
func WithSessionSettings(ctx context.Context, settings SessionSettings) context.Context {
	return context.WithValue(ctx, sessionSettingsContextKey{}, settings)
}

// SessionSettingsFromContext returns the immutable startup snapshot, when set.
func SessionSettingsFromContext(ctx context.Context) (SessionSettings, bool) {
	settings, ok := ctx.Value(sessionSettingsContextKey{}).(SessionSettings)
	return settings, ok
}

// SessionModelAndEffort resolves startup overrides while retaining CLI defaults
// for empty fields. Every model-switching adapter uses this at its snapshot seam.
func SessionModelAndEffort(ctx context.Context, model, effort string) (string, string) {
	if settings, ok := SessionSettingsFromContext(ctx); ok {
		if settings.Model != "" {
			model = settings.Model
		}
		if settings.ReasoningEffort != "" {
			effort = settings.ReasoningEffort
		}
	}
	return model, effort
}

func (e *Engine) sessionSelection(key string) sessionModelSelection {
	if e.projectState != nil {
		e.projectState.mu.RLock()
		defer e.projectState.mu.RUnlock()
		return e.projectState.state.SessionModelOverrides[key]
	}
	e.sessionModelsMu.RLock()
	defer e.sessionModelsMu.RUnlock()
	return e.sessionSelections[key]
}

// saveSessionSelection merges partial changes atomically. Failed disk writes
// leave both the applied state and the queued request intact for a later retry.
func (e *Engine) saveSessionSelection(key, model, effort string) error {
	merge := func(s sessionModelSelection) sessionModelSelection {
		if model != "" {
			s.Model = model
		}
		if effort != "" {
			s.Effort = effort
		}
		return s
	}
	if ps := e.projectState; ps != nil {
		ps.mu.Lock()
		defer ps.mu.Unlock()
		selections := make(map[string]sessionModelSelection, len(ps.state.SessionModelOverrides)+1)
		for k, v := range ps.state.SessionModelOverrides {
			selections[k] = v
		}
		selections[key] = merge(selections[key])
		next := ps.state
		next.SessionModelOverrides = selections
		if ps.storePath != "" {
			data, err := json.MarshalIndent(next, "", "  ")
			if err != nil {
				return fmt.Errorf("encode session model: %w", err)
			}
			if err := ps.write(data); err != nil {
				return fmt.Errorf("save session model: %w", err)
			}
		}
		ps.state = next
		return nil
	}
	e.sessionModelsMu.Lock()
	defer e.sessionModelsMu.Unlock()
	if e.sessionSelections == nil {
		e.sessionSelections = make(map[string]sessionModelSelection)
	}
	e.sessionSelections[key] = merge(e.sessionSelections[key])
	return nil
}

// clearSessionSelection drops a hand-picked model/effort for the session, so the
// bot default (and, for team workspaces, the per-task route) applies again.
// Reports whether there was anything to drop.
func (e *Engine) clearSessionSelection(key string) (bool, error) {
	if ps := e.projectState; ps != nil {
		ps.mu.Lock()
		defer ps.mu.Unlock()
		if _, ok := ps.state.SessionModelOverrides[key]; !ok {
			return false, nil
		}
		selections := make(map[string]sessionModelSelection, len(ps.state.SessionModelOverrides))
		for k, v := range ps.state.SessionModelOverrides {
			if k != key {
				selections[k] = v
			}
		}
		next := ps.state
		next.SessionModelOverrides = selections
		if ps.storePath != "" {
			data, err := json.MarshalIndent(next, "", "  ")
			if err != nil {
				return false, fmt.Errorf("encode session model: %w", err)
			}
			if err := ps.write(data); err != nil {
				return false, fmt.Errorf("save session model: %w", err)
			}
		}
		ps.state = next
		return true, nil
	}
	e.sessionModelsMu.Lock()
	defer e.sessionModelsMu.Unlock()
	if _, ok := e.sessionSelections[key]; !ok {
		return false, nil
	}
	delete(e.sessionSelections, key)
	return true, nil
}

func (e *Engine) sessionEffortFor(key string, agent Agent) string {
	if getter, ok := e.liveModelSession(key).(interface{ GetReasoningEffort() string }); ok {
		if effort := getter.GetReasoningEffort(); effort != "" {
			return effort
		}
	}
	if effort := e.sessionSelection(key).Effort; effort != "" {
		return effort
	}
	if rs, ok := agent.(ReasoningEffortSwitcher); ok {
		return rs.GetReasoningEffort()
	}
	return ""
}

// selectSessionModel serves chat commands/cards; the CLI uses the queued path.
func (e *Engine) selectSessionModel(key, model string) (string, error) {
	if err := e.saveSessionSelection(key, model, ""); err != nil {
		return "", err
	}
	return model, nil
}
