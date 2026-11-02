package core

import "time"

// A renewal is a new evaluation explicitly requested by an authenticated
// administrator, never a revival of the old evaluation or a replayed event.
type AuthorizationRenewal struct {
	PreviousDecisionID string    `json:"previous_decision_id"`
	DecisionID         string    `json:"decision_id"`
	TaskID             string    `json:"task_id"`
	Authority          string    `json:"authority"`
	At                 time.Time `json:"at"`
}

func (a *ProactiveAuthorization) Renew(oldID, taskID, authority string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	old, ok := a.state.Decisions[oldID]
	if !ok || old.Outcome != "eligible" || a.state.Revoked[oldID] != "" || authority == "" {
		return "", ErrAuthorizationDenied
	}
	// A failed task-journal write can retry this exact renewal without admitting
	// a second task or treating arbitrary event replays as new authorization.
	for _, r := range a.state.Renewals {
		if r.PreviousDecisionID == oldID && r.TaskID == taskID && a.checkLocked(r.DecisionID, "", true) == nil {
			return r.DecisionID, nil
		}
	}
	var assignment AuthorizationAssignment
	for _, as := range a.state.Assignments {
		if as.DecisionID == oldID && as.TaskID == taskID {
			assignment = as
		}
	}
	if assignment.TaskID == "" || a.state.Admitted[authorizationEventKey(old.Source, old.EventID)] != oldID {
		return "", ErrAuthorizationDenied
	}
	if old.PolicyVersion == a.state.Policy.Version {
		return "", ErrAuthorizationDenied
	}
	// Only a previously admitted trusted human decision supplies identity and
	// original scopes. The request body cannot provide or expand either.
	next, err := a.evaluateLocked(ProactiveCandidate{
		EventID: old.EventID, Source: old.Source, EventKind: old.EventKind, Identity: old.Identity,
		SessionKey: old.SessionKey, Scopes: old.Scopes, ActorKind: "human", Intent: "inferred",
		Authenticated: true, Visible: true,
	})
	if err != nil {
		return "", err
	}
	if err = a.checkLocked(next.ID, "", false); err != nil {
		return "", err
	}
	err = a.transaction(func(s *authorizationState) error {
		s.Admitted[authorizationEventKey(old.Source, old.EventID)] = next.ID
		assignment.DecisionID, assignment.At = next.ID, time.Now().UTC()
		s.Assignments = append(s.Assignments, assignment)
		s.Renewals = append(s.Renewals, AuthorizationRenewal{oldID, next.ID, taskID, authority, assignment.At})
		return nil
	})
	return next.ID, err
}

func (e *Engine) RenewTaskAuthorization(taskID string) (string, error) {
	if e.publicProgress == nil {
		return "", ErrAuthorizationDenied
	}
	p := e.publicProgress
	// Serialize cancellation and renewal so an explicit stop cannot be undone by
	// a policy update racing this administrator action.
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.records[taskID]
	p.mu.Unlock()
	if r == nil {
		return "", ErrAuthorizationDenied
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	task := r.record.Task
	if task.State == TaskStateCancelled || task.State == TaskStateCompleted || task.AuthorizationDecisionID == "" {
		return "", ErrAuthorizationDenied
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return "", err
	}
	old := task.AuthorizationDecisionID
	next, err := a.Renew(old, taskID, "management:administrator")
	if err != nil {
		return "", err
	}
	task.AuthorizationDecisionID = next
	pending := r.record.ProactivePending
	if pending != nil {
		copy := *pending
		copy.Authorization = &AuthorizationTurn{Project: e.name, TaskID: taskID, DecisionID: next}
		r.record.ProactivePending = &copy
	}
	if err := p.save(r); err != nil {
		task.AuthorizationDecisionID = old
		r.record.ProactivePending = pending
		return "", err
	}
	return next, nil
}
