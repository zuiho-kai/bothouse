package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
)

// ProactiveAuthorization opens one durable store per engine. Ordinary explicit
// user messages do not need this store and retain their existing permission path.
func (e *Engine) ProactiveAuthorization() (*ProactiveAuthorization, error) {
	e.proactiveMu.Lock()
	defer e.proactiveMu.Unlock()
	if e.proactiveAuthorization != nil {
		return e.proactiveAuthorization, nil
	}
	if e.dataDir == "" {
		return nil, errors.New("proactive authorization requires data_dir")
	}
	a, err := OpenProactiveAuthorization(filepath.Join(e.dataDir, "authorization", sanitizeJournalName(e.name)+".json"))
	if err != nil {
		return nil, err
	}
	e.proactiveAuthorization = a
	return a, nil
}

// EvaluateProactiveCandidate is shared by authenticated event adapters. It does
// not start an executor, acknowledge a message, or call an evaluation model.
func (e *Engine) EvaluateProactiveCandidate(c ProactiveCandidate) (AuthorizationDecision, error) {
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return AuthorizationDecision{}, err
	}
	return a.Evaluate(c)
}

// AdmitProactiveTask binds an existing task to an immutable decision. Routing
// output, a public-progress run token and a nickname cannot create this grant.
func (e *Engine) AdmitProactiveTask(decision string, task *Task, backend string) error {
	if task == nil || task.Agent != e.name || IsTerminalState(task.State) {
		return ErrAuthorizationDenied
	}
	if task.AuthorizationDecisionID != "" && task.AuthorizationDecisionID != decision {
		return ErrAuthorizationDenied
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return err
	}
	a.mu.Lock()
	d, exists := a.state.Decisions[decision]
	a.mu.Unlock()
	if !exists || d.SessionKey != task.SessionKey {
		return ErrAuthorizationDenied
	}
	if err = a.Admit(decision, task.ID, task.Agent, backend, task.SessionKey); err != nil {
		return err
	}
	if e.publicProgress != nil {
		if err = e.publicProgress.BindAuthorization(task.ID, decision); err != nil {
			return err
		}
	}
	task.AuthorizationDecisionID = decision
	return nil
}

// CheckTaskAuthorization is used at queue delivery, assignment and recovery.
// Existing explicit tasks have no proactive grant and keep the original checks.
func (e *Engine) CheckTaskAuthorization(task *Task, scope string) error {
	if task == nil {
		return ErrAuthorizationDenied
	}
	if task.AuthorizationDecisionID == "" {
		return nil
	}
	if task.State == TaskStateCompleted || task.State == TaskStateCancelled {
		return ErrAuthorizationDenied
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return err
	}
	if err = a.Check(task.AuthorizationDecisionID, scope); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for i := len(a.state.Assignments) - 1; i >= 0; i-- {
		as := a.state.Assignments[i]
		if as.DecisionID == task.AuthorizationDecisionID && as.TaskID == task.ID {
			if as.Role != task.Agent || a.state.Decisions[as.DecisionID].SessionKey != task.SessionKey {
				return ErrAuthorizationDenied
			}
			return nil
		}
	}
	return ErrAuthorizationDenied
}

// revokeCancelledTask is called while the task journal is locked. Only mutate
// the authorization ledger here; notice projection runs after the task commit.
func (e *Engine) revokeCancelledTask(task *Task) error {
	if task.AuthorizationDecisionID == "" {
		return nil
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return err
	}
	return a.Revoke(task.AuthorizationDecisionID, "task:cancelled")
}

// RunAuthorizedEffect is the controlled side-effect boundary. Callers use their
// durable operation identity, not a fresh random ID on retry. Unknown in-flight
// results require reconciliation, never an automatic second execution.
func (e *Engine) RunAuthorizedEffect(ctx context.Context, task *Task, scope, operationID string, run func(context.Context) error) error {
	if err := e.CheckTaskAuthorization(task, scope); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if task.AuthorizationDecisionID == "" {
		return run(ctx)
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return err
	}
	if operationID == "" {
		return errors.New("operation ID required")
	}
	// Retry identity belongs to a task, including after explicit policy renewal.
	// Two independent tasks may legitimately use the same operation name.
	effectID := authorizationEventKey(task.ID, operationID)
	if err = a.BeginEffect(task.AuthorizationDecisionID, scope, effectID); err != nil {
		return err
	}
	effectCtx, cancel, watchErr := e.AuthorizedTaskContext(ctx, task, scope)
	if watchErr != nil {
		err = watchErr
	} else {
		err = run(effectCtx)
		cancel()
	}
	result := "succeeded"
	// Never write raw tool errors (which may contain private input) to the ledger.
	if err != nil {
		result = "failed_or_uncertain"
	}
	if recordErr := a.FinishEffect(effectID, result); recordErr != nil {
		return errors.Join(err, fmt.Errorf("record effect outcome: %w", recordErr))
	}
	return err
}

// AuthorizedTaskContext cancels cooperative executors on committed revocation.
// Callers still check each controlled tool/outbound operation separately.
func (e *Engine) AuthorizedTaskContext(ctx context.Context, task *Task, scope string) (context.Context, context.CancelFunc, error) {
	if err := e.CheckTaskAuthorization(task, scope); err != nil {
		return nil, nil, err
	}
	child, cancel := context.WithCancel(ctx)
	if task.AuthorizationDecisionID == "" {
		return child, cancel, nil
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		cancel()
		return nil, nil, err
	}
	changed, unwatch, err := a.Watch(task.AuthorizationDecisionID)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	go func() {
		defer unwatch()
		select {
		case <-changed:
			cancel()
		case <-child.Done():
		}
	}()
	return child, cancel, nil
}

// BindAuthorization persists only the opaque decision reference in the existing
// task journal. The private evidence stays in the administrator-only ledger.
func (p *PublicProgress) BindAuthorization(taskID, decision string) error {
	if decision == "" {
		return ErrAuthorizationDenied
	}
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.records[taskID]
	p.mu.Unlock()
	if r == nil {
		return errors.New("unknown task")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	old := r.record.Task.AuthorizationDecisionID
	if IsTerminalState(r.record.Task.State) || (old != "" && old != decision) {
		return ErrAuthorizationDenied
	}
	r.record.Task.AuthorizationDecisionID = decision
	if err := p.save(r); err != nil {
		r.record.Task.AuthorizationDecisionID = old
		return err
	}
	return nil
}

// SyncAuthorizationNotices projects durable invalidations into existing task
// records. A failed projection remains in the authorization ledger for retry.
func (e *Engine) SyncAuthorizationNotices() error {
	if e.publicProgress == nil {
		return nil
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return err
	}
	b, err := a.Snapshot()
	if err != nil {
		return err
	}
	var state authorizationState
	if err = json.Unmarshal(b, &state); err != nil {
		return err
	}
	for _, notice := range state.Notices {
		if err = e.publicProgress.applyAuthorizationNotice(notice); err != nil {
			return err
		}
	}
	return nil
}
func (p *PublicProgress) applyAuthorizationNotice(n AuthorizationNotice) error {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.records[n.TaskID]
	p.mu.Unlock()
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.record.Task
	if t.AuthorizationDecisionID != n.DecisionID {
		return nil
	}
	withdrawn := n.Reason == "withdrawn"
	if t.AuthorizationNoticeVersion >= n.PolicyVersion && (!withdrawn || t.AuthorizationWithdrawn) {
		return nil
	}
	old := t.Clone()
	t.AuthorizationNoticeVersion = n.PolicyVersion
	t.AuthorizationWithdrawn = t.AuthorizationWithdrawn || withdrawn
	p.appendEvent(r, TaskEventBlocked, NewI18n(r.record.Lang).T(MsgAuthorizationRecheck), false)
	if err := p.save(r); err != nil {
		r.record.Task = old
		return err
	}
	p.mu.Lock()
	p.pending[t.ID] = r
	p.mu.Unlock()
	return nil
}
