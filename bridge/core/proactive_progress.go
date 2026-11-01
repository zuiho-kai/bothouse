package core

// beginProactiveProgress reuses the task durably admitted before execution.
// A new runtime token cannot create an unrelated task or retain an old grant.
func (e *Engine) beginProactiveProgress(ref *AuthorizationTurn, stopped func() bool) (string, error) {
	if ref.Project != e.name || e.publicProgress == nil {
		return "", ErrAuthorizationDenied
	}
	p := e.publicProgress
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.records[ref.TaskID]
	p.mu.Unlock()
	if r == nil {
		return "", ErrAuthorizationDenied
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.record.Task.AuthorizationDecisionID != ref.DecisionID || r.record.Accepted {
		return "", ErrAuthorizationDenied
	}
	if err := e.CheckTaskAuthorization(r.record.Task, "task.resume"); err != nil {
		return "", err
	}
	old := r.record
	old.Task = r.record.Task.Clone()
	if r.record.Task.State == TaskStateFailed {
		r.record.Task.State = TaskStateInProgress
		p.appendEvent(r, TaskEventProgress, e.i18n.T(MsgProactiveTaskAdmitted), false)
	}
	r.record.Closed = false
	if err := p.save(r); err != nil {
		r.record = old
		return "", err
	}
	r.boundTaskID, r.boundDecisionID = ref.TaskID, ref.DecisionID
	r.stopped, r.candidate, r.autoOff = stopped, nil, true
	r.reportBase = r.record.LastSeq
	// Source: runtime token entropy follows PublicProgress.begin.
	token := randomProgressID(32)
	p.mu.Lock()
	defer p.mu.Unlock()
	for previous, run := range p.runs {
		if run == r {
			delete(p.runs, previous)
		}
	}
	p.runs[token] = r
	p.indexRun(r)
	return token, nil
}
