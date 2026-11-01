package core

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"time"
)

// admitPlatformTask commits a journal-only task before the candidate reaches
// the ordinary execution queue. The source event, not a new run token or the
// backend name, determines its identity. Observations never call this method.
func (e *Engine) admitPlatformTask(p Platform, msg *Message, decision AuthorizationDecision) (*Task, error) {
	if e.publicProgress == nil || decision.Outcome != "eligible" || decision.SessionKey != msg.SessionKey {
		return nil, ErrAuthorizationDenied
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		return nil, err
	}
	ledger := e.publicProgress
	ledger.transitionMu.Lock()
	defer ledger.transitionMu.Unlock()
	sum := sha256.Sum256([]byte(authorizationEventKey(decision.Source, decision.EventID)))
	id := "task-" + hex.EncodeToString(sum[:])
	ledger.mu.Lock()
	existing := ledger.records[id]
	ledger.mu.Unlock()
	if existing != nil {
		existing.mu.Lock()
		pending := existing.record.ProactivePending != nil
		existing.mu.Unlock()
		if pending {
			return e.commitProactiveAdmission(existing, msg)
		}
		return nil, ErrAuthorizationDuplicate
	}
	task := &Task{ID: id, Agent: e.name, SessionKey: msg.SessionKey, Origin: p.Name(),
		Title: e.i18n.T(MsgPublicAutoTitle), State: TaskStateInProgress, CreatedAt: time.Now().UTC(),
		AuthorizationDecisionID: decision.ID}
	if err := a.Admit(decision.ID, id, e.name, e.agentTypeName(), msg.SessionKey); err != nil {
		return nil, err
	}
	r := &publicRun{record: progressRecord{Task: task, Platform: p.Name(), Lang: e.i18n.CurrentLang(), Reports: map[int64]string{}, Auto: true}}
	r.record.ProactivePending = &TurnJournalEntry{
		TurnID: "admission-" + id, Project: e.name, SessionKey: msg.SessionKey,
		InteractiveKey: e.interactiveKeyForSessionKey(msg.SessionKey), Platform: p.Name(),
		LastUserMessage: msg.Content, Trigger: turnTriggerOf(msg),
		StartedAt:     task.CreatedAt,
		Authorization: &AuthorizationTurn{Project: e.name, TaskID: id, DecisionID: decision.ID},
	}
	ledger.appendEvent(r, TaskEventCreated, e.i18n.T(MsgProactiveTaskAdmitted), true)
	if err := ledger.save(r); err != nil {
		return nil, err
	}
	ledger.mu.Lock()
	ledger.records[id] = r
	ledger.indexRun(r)
	ledger.mu.Unlock()
	return e.commitProactiveAdmission(r, msg)
}

// Caller serializes task transitions. A crash between the two journal writes
// leaves either this private intent or the pending turn, so it cannot silently
// lose a committed admission or create a second task on a replayed source event.
func (e *Engine) commitProactiveAdmission(r *publicRun, msg *Message) (*Task, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := e.CheckTaskAuthorization(r.record.Task, "task.resume"); err != nil {
		return nil, err
	}
	intent := r.record.ProactivePending
	j := e.turnJournalStore()
	if j == nil || intent == nil {
		return nil, ErrAuthorizationDenied
	}
	en, err := j.begin(*intent, false)
	if err != nil {
		return nil, err
	}
	r.record.ProactivePending = nil
	if err := e.publicProgress.save(r); err != nil {
		r.record.ProactivePending = intent
		return nil, err
	}
	if msg != nil {
		msg.resumedFrom = en.TurnID
		msg.authorization = en.Authorization
	} else {
		// The intent was inherited from the task journal rather than the turn
		// journal. Include it in this startup's existing recovery scan.
		j.mu.Lock()
		j.inherited[en.TurnID] = true
		j.mu.Unlock()
	}
	return r.record.Task.Clone(), nil
}

// Restore before any platform can start the normal turn-recovery scan. This
// uses the existing journal and scheduler, never a separate polling loop.
func (e *Engine) restoreProactiveAdmissions() {
	p := e.publicProgress
	if p == nil {
		return
	}
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	var runs []*publicRun
	for _, r := range p.records {
		runs = append(runs, r)
	}
	p.mu.Unlock()
	for _, r := range runs {
		r.mu.Lock()
		pending := r.record.ProactivePending != nil
		r.mu.Unlock()
		if pending {
			if _, err := e.commitProactiveAdmission(r, nil); err != nil {
				slog.Warn("proactive admission recovery pending", "error", err)
			}
		}
	}
}
