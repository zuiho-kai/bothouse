package core

import (
	"context"
	"log/slog"
)

// User stop and recall paths withdraw the current turn's grant before stopping
// its backend. Technical session cleanup must not call this method.
func (e *Engine) revokeInteractiveAuthorization(key string) {
	e.interactiveMu.Lock()
	state := e.interactiveStates[key]
	e.interactiveMu.Unlock()
	if state == nil {
		return
	}
	state.mu.Lock()
	ref := state.authorization
	state.mu.Unlock()
	if ref == nil {
		return
	}
	ctx, err := e.authorizationExecution(ref)
	if err == nil {
		execution := ctx.Value(proactiveExecutionKey{}).(proactiveExecution)
		var a *ProactiveAuthorization
		a, err = execution.source.ProactiveAuthorization()
		if err == nil {
			err = a.Revoke(ref.DecisionID, "human:stop")
		}
	}
	if err != nil {
		slog.Error("stop authorization persistence failed", "task_id", ref.TaskID, "error", err)
	}
}

// AuthorizationTurn is an opaque reference carried by the internal queue and
// restart journal. Platform payloads cannot set Message.authorization.
type AuthorizationTurn struct {
	Project    string `json:"project"`
	TaskID     string `json:"task_id"`
	DecisionID string `json:"decision_id"`
}

// Record the backend actually receiving the turn without changing its source
// identity or session. Workspace selection does not create another grant.
func (e *Engine) recordTurnBackend(ref *AuthorizationTurn, backend string) error {
	if ref == nil {
		return nil
	}
	ctx, err := e.authorizationExecution(ref)
	if err != nil {
		return err
	}
	if err := checkProactiveExecution(ctx, "task.resume"); err != nil {
		return err
	}
	execution := ctx.Value(proactiveExecutionKey{}).(proactiveExecution)
	task, ok := execution.source.publicProgress.Task(ref.TaskID)
	if !ok {
		return ErrAuthorizationDenied
	}
	a, err := execution.source.ProactiveAuthorization()
	if err != nil {
		return err
	}
	return a.Reassign(ref.DecisionID, task.ID, task.Agent, backend, task.SessionKey)
}

func (e *Engine) watchTurnAuthorization(ref *AuthorizationTurn) (<-chan struct{}, func(), error) {
	if ref == nil {
		return nil, func() {}, nil
	}
	ctx, err := e.authorizationExecution(ref)
	if err != nil {
		return nil, func() {}, err
	}
	execution := ctx.Value(proactiveExecutionKey{}).(proactiveExecution)
	a, err := execution.source.ProactiveAuthorization()
	if err != nil {
		return nil, func() {}, err
	}
	changed, unwatch, err := a.Watch(ref.DecisionID)
	if err != nil {
		return nil, func() {}, err
	}
	return changed, unwatch, nil
}

func (e *Engine) authorizationExecution(ref *AuthorizationTurn) (context.Context, error) {
	if ref == nil {
		return context.Background(), nil
	}
	source := e
	if ref.Project != e.name {
		if e.relayManager == nil {
			return nil, ErrAuthorizationDenied
		}
		e.relayManager.mu.RLock()
		source = e.relayManager.engines[ref.Project]
		e.relayManager.mu.RUnlock()
	}
	if source == nil || source.publicProgress == nil || ref.DecisionID == "" {
		return nil, ErrAuthorizationDenied
	}
	task, ok := source.publicProgress.Task(ref.TaskID)
	if !ok || task.AuthorizationDecisionID != ref.DecisionID {
		return nil, ErrAuthorizationDenied
	}
	return withProactiveExecution(context.Background(), source, task), nil
}

func (e *Engine) checkTurnAuthorization(ref *AuthorizationTurn, scope string) error {
	ctx, err := e.authorizationExecution(ref)
	if err != nil {
		return err
	}
	return checkProactiveExecution(ctx, scope)
}

func (e *Engine) respondTurnPermission(state *interactiveState, session AgentSession, id string, result PermissionResult) error {
	state.mu.Lock()
	ref := state.authorization
	state.mu.Unlock()
	ctx, err := e.authorizationExecution(ref)
	if err != nil {
		if result.Behavior == "allow" {
			_ = session.RespondPermission(id, PermissionResult{Behavior: "deny"})
			return err
		}
		return session.RespondPermission(id, result)
	}
	return respondTaskPermission(ctx, session, id, result)
}

// Different decisions never become one resumed prompt. An explicit message
// cannot carry a stopped automatic task through recovery as quoted context.
func turnAuthorizationGroup(en TurnJournalEntry) string {
	if en.Authorization == nil {
		return en.InteractiveKey
	}
	return en.InteractiveKey + "\x00" + en.Authorization.Project + "\x00" + en.Authorization.TaskID + "\x00" + en.Authorization.DecisionID
}

func (e *Engine) journalPendingAuthorizationTurn(q *queuedMessage, key, workspace string) (string, error) {
	j := e.turnJournalStore()
	if j == nil {
		return "", ErrAuthorizationDenied
	}
	entry, err := j.begin(TurnJournalEntry{
		Project: e.name, SessionKey: q.msgSessionKey, InteractiveKey: key, WorkspaceDir: workspace,
		Platform: q.msgPlatform, Trigger: queuedTurnTrigger(q), LastUserMessage: q.content,
		Authorization: q.authorization, TimerJobID: q.timerJobID, NoProgressCount: q.resumeNoProgress,
	}, false)
	return entry.TurnID, err
}
