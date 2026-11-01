package core

import "context"

// AuthorizationTurn is an opaque reference carried by the internal queue and
// restart journal. Platform payloads cannot set Message.authorization.
type AuthorizationTurn struct {
	Project    string `json:"project"`
	TaskID     string `json:"task_id"`
	DecisionID string `json:"decision_id"`
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
