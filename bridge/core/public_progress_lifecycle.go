package core

import (
	"errors"
	"sort"
	"strings"
	"time"
)

// cardResumeWindow bounds how long a card stays open for follow-up work. An
// older card is treated as history: the next task in that session starts fresh
// instead of appending to a card nobody is watching any more.
const cardResumeWindow = 24 * time.Hour

// defaultTaskListLimit caps a task query so a long-running session cannot dump
// the whole journal into one reply.
const defaultTaskListLimit = 10

// resumableTask reports whether later work in the same session attaches to this
// card. A card that never carried a public fact is not a card yet, and an
// accepted result is closed for good.
func resumableTask(t *Task, accepted bool, now time.Time) bool {
	if t == nil || accepted {
		return false
	}
	switch t.State {
	case TaskStateCompleted, TaskStateCancelled:
		return false
	}
	if t.Seq == 0 {
		return false
	}
	if !t.UpdatedAt.IsZero() && now.Sub(t.UpdatedAt) > cardResumeWindow {
		return false
	}
	return true
}

// runStart reports the card this turn may continue: its id and the sequence
// number that continuation would use. ok is false when the session has no open
// card, in which case the turn can only start one.
func (p *PublicProgress) runStart(token string) (taskID string, resumeSeq int64, ok bool) {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.runs[token]
	p.mu.Unlock()
	if r == nil {
		return "", 0, false
	}
	r.mu.Lock()
	cand := r.candidate
	r.mu.Unlock()
	if cand == nil {
		return "", 0, false
	}
	cand.mu.Lock()
	defer cand.mu.Unlock()
	if !cand.record.Closed || cand.record.Task.SessionKey != r.record.Task.SessionKey ||
		!resumableTask(cand.record.Task, cand.record.Accepted, time.Now()) {
		return "", 0, false
	}
	return cand.record.Task.ID, cand.record.LastSeq + 1, true
}

// lockReportRun selects and locks the target without changing it. The caller
// holds transitionMu, so finish/Accept cannot revoke the source run or adopt
// the same card between validation and durable commit. Delivery only changes
// transport checkpoints under the target's own mutex.
func (p *PublicProgress) lockReportRun(r *publicRun, req PublicProgressRequest) (*publicRun, error) {
	r.mu.Lock()
	if r.record.Closed || r.record.Accepted || (r.stopped != nil && r.stopped()) || r.record.Task.SessionKey != req.SessionKey {
		r.mu.Unlock()
		return nil, errors.New("run is not active for this session")
	}
	cand := r.candidate
	if r.record.LastSeq > 0 || cand == nil || req.Kind == "start" {
		return r, nil
	}
	r.mu.Unlock()
	cand.mu.Lock()
	if !cand.record.Closed || cand.record.Task.SessionKey != req.SessionKey || cand.record.LastSeq == 0 ||
		!resumableTask(cand.record.Task, cand.record.Accepted, time.Now()) || req.Seq != cand.record.LastSeq+1 {
		cand.mu.Unlock()
		return nil, errors.New("card cannot be continued with this sequence")
	}
	return cand, nil
}

// Accept records the human's acceptance. It is the only path to TaskStateCompleted:
// a turn result alone never proves that the owner accepted the work.
func (p *PublicProgress) Accept(taskID, actor string) (*Task, error) {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	actor = strings.TrimSpace(actor)
	if actor == "" {
		return nil, errors.New("acceptance needs the human who confirmed it")
	}
	p.mu.Lock()
	r := p.records[taskID]
	p.mu.Unlock()
	if r == nil {
		return nil, errors.New("unknown task")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.record.Task
	if r.record.Accepted || t.State == TaskStateCompleted {
		return t.Clone(), nil
	}
	if t.State != TaskStateResultReady && t.State != TaskStateWaitingUser {
		return nil, errors.New("only a delivered result can be accepted")
	}
	for _, member := range t.Members {
		if member.Live() {
			return nil, errors.New("task still has unfinished members")
		}
	}
	old := r.record
	old.Task = t.Clone()
	now := time.Now().UTC()
	r.record.Accepted = true
	r.record.Closed = true
	t.State = TaskStateCompleted
	t.FactStage = FactStageVerified
	t.CompletedAt = &now
	p.appendEvent(r, TaskEventCompleted, NewI18n(r.record.Lang).Tf(MsgPublicAccepted, actor), true)
	if err := p.save(r); err != nil {
		r.record = old
		return nil, err
	}
	// Release the session so the next task opens its own card, and re-deliver the
	// acceptance to the platform even if the card is otherwise up to date.
	p.mu.Lock()
	if p.open[t.SessionKey] == r {
		delete(p.open, t.SessionKey)
	}
	p.pending[t.ID] = r
	p.indexRun(r)
	p.revokeMemberRuns(r)
	p.mu.Unlock()
	return t.Clone(), nil
}

// Task returns a copy of one journalled task.
func (p *PublicProgress) Task(taskID string) (*Task, bool) {
	p.mu.Lock()
	r := p.records[taskID]
	p.mu.Unlock()
	if r == nil {
		return nil, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.record.Task.Clone(), true
}

// Tasks lists recent tasks, newest first. An empty session lists every session
// in this project.
func (p *PublicProgress) Tasks(session string, limit int) []*Task {
	if limit <= 0 {
		limit = defaultTaskListLimit
	}
	p.mu.Lock()
	runs := make([]*publicRun, 0, len(p.records))
	for _, r := range p.records {
		runs = append(runs, r)
	}
	p.mu.Unlock()
	out := make([]*Task, 0, len(runs))
	for _, r := range runs {
		r.mu.Lock()
		if session == "" || r.record.Task.SessionKey == session {
			out = append(out, r.record.Task.Clone())
		}
		r.mu.Unlock()
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}
