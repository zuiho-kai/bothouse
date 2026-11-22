package core

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
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

// ---- #2075: a model picked for one handed-off task ----
//
// ws-handoff --model queues an ordinary switch on the workspace session (applied before its next
// turn, like `model set`) and remembers the selection the session had before. When the workspace
// is given back (ResetTeamWorkspaceSessions) that selection comes back, so the next task there
// starts on the workspace's usual model again. A later pick for the same task (ws-forward
// --model) keeps the first remembered selection.

// QueueHandoffModelSwitch is QueueModelSwitch for a handed-off task on workspace session key. The
// queued switch and the selection to restore are saved in one write (review #2076 item 1): a failed
// write leaves neither, so a give-back never finds a switch without the selection it replaces.
func (e *Engine) QueueHandoffModelSwitch(ctx context.Context, key, model, effort string) ModelSwitchResult {
	agent, _ := e.sessionContextForKey(key)
	p, res := e.resolveModelSwitch(ctx, key, agent, model, effort)
	if !res.OK {
		return res
	}
	// Review #2076 item 3: a switch applies when a turn starts (processInteractiveMessageWith →
	// applyPendingSwitchOnAgent). While a turn runs, a forward is injected into it or queued and
	// drained into the same process, so it would reach the old model. Refuse instead of pretending.
	if e.sessionTurnRunning(key) {
		return ModelSwitchResult{Message: "the workspace is in the middle of a turn: a model picked now would only start with its next fresh turn, and this message would reach the model running now. Not switched: forward without --model, or pick the model after this turn ends"}
	}
	if err := e.queueHandoffSwitch(key, p); err != nil {
		return ModelSwitchResult{Message: err.Error()}
	}
	res.Message = "queued for this task: takes effect from the workspace's next turn; the workspace's own model comes back when it is given back"
	return res
}

// sessionTurnRunning: the active session of key holds its turn lock (the lock a timer-started turn
// takes with TryLock in ExecuteTimerJob).
func (e *Engine) sessionTurnRunning(key string) bool {
	_, sessions := e.sessionContextForKey(key)
	if sessions == nil {
		return false
	}
	s := sessions.FindByID(sessions.ActiveSessionID(key))
	return s != nil && s.Busy()
}

// queueHandoffSwitch queues p on key and, unless an earlier pick for the same task already did,
// remembers the selection key has now; both or neither are published.
func (e *Engine) queueHandoffSwitch(key string, p pendingModelSwitch) error {
	e.modelSwitchMu.Lock()
	defer e.modelSwitchMu.Unlock()
	pending := maps.Clone(e.pendingSwitch)
	if pending == nil {
		pending = make(map[string]pendingModelSwitch)
	}
	p.QueuedAt = time.Now()
	pending[key] = p
	remember := func(bases, selections map[string]sessionModelSelection) map[string]sessionModelSelection {
		if _, ok := bases[key]; ok {
			return bases
		}
		bases = maps.Clone(bases)
		if bases == nil {
			bases = make(map[string]sessionModelSelection)
		}
		before := selections[key]
		before.ChangedAt = time.Time{}
		bases[key] = before
		return bases
	}
	if ps := e.projectState; ps != nil {
		ps.mu.Lock()
		defer ps.mu.Unlock()
		next := ps.state
		next.PendingModelSwitches = pending
		next.HandoffModelBases = remember(next.HandoffModelBases, next.SessionModelOverrides)
		if ps.storePath != "" {
			data, err := json.MarshalIndent(next, "", "  ")
			if err != nil {
				return fmt.Errorf("encode handoff model: %w", err)
			}
			if err := ps.write(data); err != nil {
				return fmt.Errorf("save handoff model: %w", err)
			}
		}
		ps.state = next
	} else {
		e.sessionModelsMu.Lock()
		e.handoffModelBases = remember(e.handoffModelBases, e.sessionSelections)
		e.sessionModelsMu.Unlock()
	}
	e.pendingSwitch = pending
	slog.Info("handoff model switch queued", "session", key, "model", p.Model, "effort", p.Effort)
	return nil
}

// restoreWorkspaceHandoffModels puts every role's sessions in workspace key back on the model they
// had before a handed-off task picked one (restoreHandoffModels on each engine). Every give-back
// (park, handback, idle free, delete) runs it before it commits the release (review #2076 round 2:
// a give-back committed first and restored after could only log a failed restore, so the
// workspace went back to the pool still on the task's model). An error means the release must not
// happen: the workspace stays with its task and the next give-back tries again.
func (e *Engine) restoreWorkspaceHandoffModels(key string) error {
	for _, x := range e.watchEngines() {
		if _, err := x.restoreHandoffModels(key); err != nil {
			return fmt.Errorf("%s: put the task's model back: %w", x.name, err)
		}
	}
	return nil
}

// restoreHandoffModels puts back the selection of every session in workspace chat that a
// handed-off task changed, and drops a switch for that task still queued there. Returns how many
// sessions were restored; on a failed write nothing changes and the error is returned.
func (e *Engine) restoreHandoffModels(chat string) (int, error) {
	chat = chatOf(chat)
	restore := func(bases, selections map[string]sessionModelSelection, pending map[string]pendingModelSwitch) int {
		n := 0
		for k, base := range bases {
			if chatOf(k) != chat {
				continue
			}
			delete(bases, k)
			delete(pending, k)
			if base == (sessionModelSelection{}) {
				delete(selections, k)
			} else {
				selections[k] = base
			}
			n++
		}
		return n
	}
	e.modelSwitchMu.Lock()
	defer e.modelSwitchMu.Unlock()
	pending := maps.Clone(e.pendingSwitch)
	if ps := e.projectState; ps != nil {
		ps.mu.Lock()
		defer ps.mu.Unlock()
		next := ps.state
		next.HandoffModelBases = maps.Clone(next.HandoffModelBases)
		next.SessionModelOverrides = maps.Clone(next.SessionModelOverrides)
		if next.SessionModelOverrides == nil {
			next.SessionModelOverrides = make(map[string]sessionModelSelection)
		}
		n := restore(next.HandoffModelBases, next.SessionModelOverrides, pending)
		if n == 0 {
			return 0, nil
		}
		next.PendingModelSwitches = pending
		if ps.storePath != "" {
			data, err := json.MarshalIndent(next, "", "  ")
			if err == nil {
				err = ps.write(data)
			}
			if err != nil {
				return 0, fmt.Errorf("save restored model of %s: %w", chat, err)
			}
		}
		ps.state = next
		e.pendingSwitch = pending
		slog.Info("handoff model: workspace back on its own model", "workspace", chat, "sessions", n)
		return n, nil
	}
	e.sessionModelsMu.Lock()
	defer e.sessionModelsMu.Unlock()
	if e.sessionSelections == nil {
		e.sessionSelections = make(map[string]sessionModelSelection)
	}
	n := restore(e.handoffModelBases, e.sessionSelections, pending)
	if n > 0 {
		e.pendingSwitch = pending
	}
	return n, nil
}
