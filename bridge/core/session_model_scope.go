package core

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"time"
)

// sessionModelSelection is independent of the native conversation ID: /new and
// process reconstruction retain the channel's selection. Directory defaults and
// configured session_models remain fallbacks for channels without a selection.
type sessionModelSelection struct {
	Model     string    `json:"model,omitempty"`
	Effort    string    `json:"effort,omitempty"`
	ChangedAt time.Time `json:"changed_at,omitzero"`
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
	_, err := e.updateSessionModelState(key, sessionModelSelection{Model: model, Effort: effort}, false, nil)
	return err
}

// updateSessionModelState commits a selection and the queue together. A nil
// queue leaves stored requests untouched. A non-nil queue is owned by the caller
// and only published after the write succeeds.
func (e *Engine) updateSessionModelState(key string, selection sessionModelSelection, clear bool, pending map[string]pendingModelSwitch) (bool, error) {
	update := func(selections map[string]sessionModelSelection) (map[string]sessionModelSelection, bool) {
		current, exists := selections[key]
		if clear {
			delete(selections, key)
			if request, queued := pending[key]; exists && queued && request.Auto {
				request.Dropped = true
				pending[key] = request
			}
			return selections, exists
		}
		if selection == (sessionModelSelection{}) {
			return selections, false
		}
		if selections == nil {
			selections = make(map[string]sessionModelSelection)
		}
		if selection.Model != "" {
			current.Model = selection.Model
			current.ChangedAt = time.Now()
		}
		if selection.Effort != "" {
			current.Effort = selection.Effort
		}
		selections[key] = current
		return selections, false
	}
	if ps := e.projectState; ps != nil {
		ps.mu.Lock()
		defer ps.mu.Unlock()
		next := ps.state
		selections, cleared := update(maps.Clone(next.SessionModelOverrides))
		next.SessionModelOverrides = selections
		if pending != nil {
			next.PendingModelSwitches = pending
		}
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
		return cleared, nil
	}
	e.sessionModelsMu.Lock()
	defer e.sessionModelsMu.Unlock()
	selections, cleared := update(e.sessionSelections)
	e.sessionSelections = selections
	return cleared, nil
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
