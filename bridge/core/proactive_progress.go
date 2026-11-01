package core

import "log/slog"

// A denied queued/resumed turn may never obtain a runtime progress token.
// Finish its admitted task by the original reference, not the previous token.
func (e *Engine) failAuthorizedTurn(ref *AuthorizationTurn) {
	ctx, err := e.authorizationExecution(ref)
	if err != nil {
		slog.Error("denied turn task lookup failed", "error", err)
		return
	}
	execution := ctx.Value(proactiveExecutionKey{}).(proactiveExecution)
	p := execution.source.publicProgress
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.records[ref.TaskID]
	p.mu.Unlock()
	r.mu.Lock()
	matches := r.record.Task.AuthorizationDecisionID == ref.DecisionID
	r.mu.Unlock()
	if matches {
		p.finishRun(r, "failed", false)
	}
}

// System status remains visible after withdrawal; model-authored fields do not.
// Construct the transport view from known metadata so newly added content fields
// cannot accidentally bypass the send scope. The journal retains the originals.
func (p *PublicProgress) authorizedTaskView(task *Task, lang Language) *Task {
	if task.AuthorizationDecisionID == "" || (p.checkAuthorization != nil && p.checkAuthorization(task, "message.send") == nil) {
		return task
	}
	i := NewI18n(lang)
	view := &Task{ID: task.ID, Agent: task.Agent, Origin: task.Origin, SessionKey: task.SessionKey,
		State: task.State, Seq: task.Seq, Revision: task.Revision, CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt,
		ChannelID: task.ChannelID, MessageID: task.MessageID, ThreadID: task.ThreadID, CardURL: task.CardURL, CardSession: task.CardSession,
		Title: i.T(MsgPublicAutoTitle), LatestProgress: i.T(MsgAuthorizationRecheck),
		AuthorizationDecisionID: task.AuthorizationDecisionID, AuthorizationWithdrawn: task.AuthorizationWithdrawn,
		AuthorizationNoticeVersion: task.AuthorizationNoticeVersion}
	if task.State == TaskStateFailed {
		view.LatestProgress = i.T(MsgPublicInterrupted)
	}
	return view
}

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
