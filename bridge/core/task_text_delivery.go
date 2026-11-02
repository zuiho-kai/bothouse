package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// TaskTextSender sends one prepared part without hidden retries or fallbacks.
// An empty receipt, even with nil error, is not an acknowledgement.
type TaskTextSender interface {
	PrepareTaskText(string) []string
	SendTaskTextPart(context.Context, string, string, string) (string, error)
}

// Only explicit evidence permits retry. Transport errors remain ambiguous.
var (
	ErrTaskTextNotAccepted = errors.New("task text definitely not accepted")
	ErrTaskTextRejected    = errors.New("task text permanently rejected")
	ErrTaskTextDenied      = errors.New("task text authorization denied")
)

type TaskTextRequest struct {
	TaskID     string `json:"task_id"`
	Revision   int    `json:"revision"`
	DeliveryID string `json:"delivery_id"`
	SessionKey string `json:"session_key"`
	Kind       string `json:"kind"`
	Text       string `json:"text"`
}

type TaskTextPart struct {
	State     string `json:"state"`
	MessageID string `json:"message_id"`
}

// TaskTextDelivery is public metadata. Text is only in the private task journal.
type TaskTextDelivery struct {
	ID         string         `json:"id"`
	TaskID     string         `json:"task_id"`
	Revision   int            `json:"revision"`
	Project    string         `json:"project"`
	Target     string         `json:"target"`
	Kind       string         `json:"kind"`
	BodyRef    string         `json:"body_ref"`
	State      string         `json:"state"`
	Parts      []TaskTextPart `json:"parts"`
	Resolution string         `json:"resolution"`
}

type taskTextRecord struct {
	TaskTextDelivery
	Body                []string `json:"body"`
	QuestionSeq         int64
	QuestionRecoverySeq int64
}

func copyTaskText(d *taskTextRecord) TaskTextDelivery {
	c := d.TaskTextDelivery
	c.Parts = append([]TaskTextPart(nil), c.Parts...)
	return c
}

func (p *PublicProgress) taskTextRun(id string) (*publicRun, error) {
	p.mu.Lock()
	r := p.records[id]
	p.mu.Unlock()
	if r == nil {
		return nil, errors.New("task not found for this project")
	}
	return r, nil
}

func (p *PublicProgress) QueueTaskText(req TaskTextRequest) (TaskTextDelivery, error) {
	if req.TaskID == "" || req.DeliveryID == "" || req.SessionKey == "" || req.Revision < 1 || strings.TrimSpace(req.Text) == "" {
		return TaskTextDelivery{}, errors.New("task, revision, delivery ID, explicit session and text required")
	}
	if req.Kind != "result" && req.Kind != "receipt" && req.Kind != "question" {
		return TaskTextDelivery{}, errors.New("invalid task text kind")
	}
	r, err := p.taskTextRun(req.TaskID)
	if err != nil {
		return TaskTextDelivery{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	hash := sha256.Sum256([]byte(req.Text))
	bodyRef := hex.EncodeToString(hash[:])
	for _, d := range r.record.TextDeliveries {
		if d.ID != req.DeliveryID {
			continue
		}
		if d.Revision != req.Revision || d.Target != req.SessionKey || d.Kind != req.Kind || d.BodyRef != bodyRef {
			return TaskTextDelivery{}, errors.New("delivery ID already used for a different request")
		}
		return copyTaskText(d), nil
	}
	if req.Revision != r.record.Task.RevisionNo() || taskTextStopped(r.record.Task, p.project, r.record.Accepted) {
		return TaskTextDelivery{}, errors.New("task cancelled or revision superseded")
	}
	if req.Kind == "question" && r.record.Task.State != TaskStateWaitingUser {
		return TaskTextDelivery{}, errors.New("question requires a waiting task")
	}
	if p.checkTaskText != nil {
		if err := p.checkTaskText(context.Background(), r.record.Task.Clone(), req.SessionKey); err != nil {
			return TaskTextDelivery{}, err
		}
	}
	if !strings.HasPrefix(req.SessionKey, r.record.Platform+":") {
		return TaskTextDelivery{}, errors.New("task target platform mismatch")
	}
	sender := p.textSenders[r.record.Platform]
	if sender == nil {
		return TaskTextDelivery{}, errors.New("platform has no task text receipt capability")
	}
	parts := sender.PrepareTaskText(req.Text)
	if len(parts) == 0 {
		return TaskTextDelivery{}, errors.New("empty prepared text")
	}
	d := &taskTextRecord{TaskTextDelivery: TaskTextDelivery{ID: req.DeliveryID, TaskID: req.TaskID, Revision: req.Revision, Project: p.project, Target: req.SessionKey, Kind: req.Kind, BodyRef: bodyRef, State: "pending"}, Body: parts}
	if req.Kind == "question" {
		d.QuestionSeq = r.record.Task.Seq
	}
	for range parts {
		d.Parts = append(d.Parts, TaskTextPart{State: "pending"})
	}
	old, dirty := r.record.TextDeliveries, r.dirty
	r.record.TextDeliveries = append(r.record.TextDeliveries, d)
	if err := p.save(r); err != nil {
		r.record.TextDeliveries, r.dirty = old, dirty
		return TaskTextDelivery{}, fmt.Errorf("persist task text: %w", err)
	}
	return copyTaskText(d), nil
}

func (p *PublicProgress) TaskTextDeliveries(taskID string) ([]TaskTextDelivery, error) {
	r, err := p.taskTextRun(taskID)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]TaskTextDelivery, 0, len(r.record.TextDeliveries))
	for _, d := range r.record.TextDeliveries {
		result = append(result, copyTaskText(d))
	}
	return result, nil
}

// ResolveTaskText records an explicit operator decision. Unknown is never
// automatically retried; confirming absence requires evidence from the caller.
func (p *PublicProgress) ResolveTaskText(taskID, id, action, evidence string) error {
	if strings.TrimSpace(evidence) == "" {
		return errors.New("resolution evidence required")
	}
	r, err := p.taskTextRun(taskID)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, d := range r.record.TextDeliveries {
		if d.ID != id {
			continue
		}
		old := copyTaskText(d)
		switch action {
		case "cancel":
			if d.State == "sent" {
				return errors.New("sent delivery cannot be cancelled")
			}
			for i := range d.Parts {
				if d.Parts[i].State == "pending" {
					d.Parts[i].State = "cancelled"
				}
			}
			// In-flight/unknown parts cannot be recalled or silently skipped.
			if d.State != "sending" && d.State != "unknown" {
				d.State = "cancelled"
			}
		case "sent", "not-accepted":
			if d.State != "unknown" {
				return errors.New("resolution requires unknown delivery")
			}
			for i := range d.Parts {
				if d.Parts[i].State != "unknown" {
					continue
				}
				if action == "sent" {
					d.Parts[i].State = "sent"
					d.Parts[i].MessageID = evidence
				} else {
					d.Parts[i].State = "pending"
				}
			}
			d.State = taskTextState(d)
		default:
			return errors.New("invalid resolution action")
		}
		d.Resolution = evidence
		dirty := r.dirty
		if err := p.save(r); err != nil {
			d.TaskTextDelivery = old
			r.dirty = dirty
			return err
		}
		return nil
	}
	return errors.New("delivery not found")
}

func taskTextState(d *taskTextRecord) string {
	for _, part := range d.Parts {
		if part.State != "sent" {
			return part.State
		}
	}
	return "sent"
}

// Different tasks progress independently; each task has one delivery owner.
// Called by the existing public progress tick, not a second scheduler/outbox.
func (p *PublicProgress) FlushTaskText(ctx context.Context) {
	p.mu.Lock()
	runs := make([]*publicRun, 0, len(p.records))
	for _, r := range p.records {
		runs = append(runs, r)
	}
	p.mu.Unlock()
	var wg sync.WaitGroup
	for _, r := range runs {
		if !r.textMu.TryLock() {
			continue
		}
		wg.Add(1)
		go func(r *publicRun) { defer wg.Done(); defer r.textMu.Unlock(); p.flushTaskText(ctx, r) }(r)
	}
	wg.Wait()
}

func (p *PublicProgress) flushTaskText(ctx context.Context, r *publicRun) {
	r.mu.Lock()
	defer r.mu.Unlock()
	blocked := map[string]bool{}
	for _, d := range r.record.TextDeliveries {
		if ctx.Err() != nil {
			return
		}
		if d.State == "sent" || d.State == "cancelled" {
			continue
		}
		if blocked[d.Target] {
			continue
		}
		blocked[d.Target] = true
		// A previous process (or failed checkpoint) may have sent this part.
		if d.State == "sending" {
			for i := range d.Parts {
				if d.Parts[i].State == "sending" {
					d.Parts[i].State = "unknown"
				}
			}
			d.State = "unknown"
			if p.save(r) != nil {
				return
			}
		}
		if r.dirty && p.save(r) != nil {
			return
		}
		if d.State != "pending" {
			continue
		}
		for i := range d.Parts {
			if d.Parts[i].State != "pending" {
				continue
			}
			if p.waitTaskText != nil {
				platform := r.record.Platform
				r.mu.Unlock()
				err := p.waitTaskText(ctx, platform)
				r.mu.Lock()
				if err != nil {
					return
				}
				if d.Parts[i].State != "pending" {
					continue
				}
			}
			if taskTextStopped(r.record.Task, p.project, r.record.Accepted) || d.Revision != r.record.Task.RevisionNo() || !taskTextQuestionOpen(r.record.Task, d) {
				for j := range d.Parts {
					if d.Parts[j].State == "pending" {
						d.Parts[j].State = "cancelled"
					}
				}
				d.State = "cancelled"
				if p.save(r) != nil {
					return
				}
				break
			}
			if ctx.Err() != nil {
				return
			}
			// Authorization hook is set before Start; #751 supplies decisions.
			if p.checkTaskText != nil {
				if err := p.checkTaskText(ctx, r.record.Task.Clone(), d.Target); err != nil {
					if errors.Is(err, ErrTaskTextDenied) {
						for j := range d.Parts {
							if d.Parts[j].State == "pending" {
								d.Parts[j].State = "cancelled"
							}
						}
						d.State = "cancelled"
						if p.save(r) != nil {
							return
						}
					}
					break
				}
			}
			sender := p.textSenders[r.record.Platform]
			if sender == nil || d.Project != p.project {
				break
			}
			d.Parts[i].State, d.State = "sending", "sending"
			if err := p.save(r); err != nil {
				d.Parts[i].State, d.State = "pending", "pending"
				return
			}
			key := fmt.Sprintf("%s/%s/%s/%d", p.project, d.TaskID, d.ID, i)
			r.mu.Unlock()
			messageID, err := sender.SendTaskTextPart(ctx, d.Target, key, d.Body[i])
			r.mu.Lock()
			switch {
			case messageID != "":
				d.Parts[i] = TaskTextPart{State: "sent", MessageID: messageID}
			case errors.Is(err, ErrTaskTextNotAccepted):
				d.Parts[i].State = "pending"
			case errors.Is(err, ErrTaskTextRejected):
				d.Parts[i].State = "permanent_failure"
			default:
				d.Parts[i].State = "unknown"
			}
			d.State = taskTextState(d)
			if p.save(r) != nil {
				return
			}
			if d.Parts[i].State != "sent" {
				break
			}
		}
		if d.State == "sent" || d.State == "cancelled" {
			blocked[d.Target] = false
		}
	}
}

func taskTextStopped(t *Task, project string, accepted bool) bool {
	return t.State == TaskStateCancelled || t.State == TaskStateCompleted || accepted || (t.AssignedProject != "" && t.AssignedProject != project)
}

func taskTextQuestionOpen(t *Task, d *taskTextRecord) bool {
	if d.Kind != "question" {
		return true
	}
	return (t.State == TaskStateWaitingUser && t.Seq == d.QuestionSeq) || (t.State == TaskStateFailed && d.QuestionRecoverySeq != 0 && t.Seq == d.QuestionRecoverySeq)
}

// SetTaskTextCheck runs immediately before every external send, including
// recovered work. Configure before starting the delivery loop.
func (p *PublicProgress) SetTaskTextCheck(check func(context.Context, *Task, string) error) {
	p.checkTaskText = check
}

func (e *Engine) SendTaskText(ctx context.Context, req TaskTextRequest) (TaskTextDelivery, error) {
	if e.publicProgress == nil {
		return TaskTextDelivery{}, errors.New("task journal unavailable")
	}
	if err := ctx.Err(); err != nil {
		return TaskTextDelivery{}, err
	}
	return e.publicProgress.QueueTaskText(req)
}
