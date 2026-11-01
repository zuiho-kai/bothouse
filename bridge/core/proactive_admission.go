package core

import (
	"crypto/sha256"
	"encoding/hex"
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
		return nil, ErrAuthorizationDuplicate
	}
	task := &Task{ID: id, Agent: e.name, SessionKey: msg.SessionKey, Origin: p.Name(),
		Title: e.i18n.T(MsgPublicAutoTitle), State: TaskStateInProgress, CreatedAt: time.Now().UTC(),
		AuthorizationDecisionID: decision.ID}
	if err := a.Admit(decision.ID, id, e.name, e.agentTypeName(), msg.SessionKey); err != nil {
		return nil, err
	}
	r := &publicRun{record: progressRecord{Task: task, Platform: p.Name(), Lang: e.i18n.CurrentLang(), Reports: map[int64]string{}, Auto: true}}
	ledger.appendEvent(r, TaskEventCreated, e.i18n.T(MsgProactiveTaskAdmitted), true)
	if err := ledger.save(r); err != nil {
		return nil, err
	}
	ledger.mu.Lock()
	ledger.records[id] = r
	ledger.indexRun(r)
	ledger.mu.Unlock()
	return task.Clone(), nil
}
