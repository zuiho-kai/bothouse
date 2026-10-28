package core

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// TaskArtifactRole separates material the user supplied from work the agent
// delivers. A rework names the output it changes; an input stays as history.
type TaskArtifactRole string

const (
	TaskArtifactInput  TaskArtifactRole = "input"
	TaskArtifactOutput TaskArtifactRole = "output"
)

// TaskArtifact is a durable reference to one revision of a task's material or
// deliverable. Ref is a locator the owner can check (URL, repository path or
// absolute path); it is never proof that the bytes were uploaded or delivered.
// The journal stores references only: public cards must show a link only when
// Ref is an http(s) URL, and /task is a local query.
type TaskArtifact struct {
	ID        string           `json:"id"`
	TaskID    string           `json:"task_id"`
	Role      TaskArtifactRole `json:"role"`
	Kind      string           `json:"kind"` // file/image/video/audio/link/text
	Label     string           `json:"label"`
	Ref       string           `json:"ref"`
	Summary   string           `json:"summary,omitempty"`
	Revision  int              `json:"revision"` // task revision this artifact belongs to
	CreatedAt time.Time        `json:"created_at"`
}

// TaskArtifactRequest attaches one artifact reference to an existing task.
type TaskArtifactRequest struct {
	Project string `json:"project"`
	TaskID  string `json:"task_id"`
	Role    string `json:"role"`
	Kind    string `json:"kind"`
	Label   string `json:"label"`
	Ref     string `json:"ref"`
	Summary string `json:"summary,omitempty"`
}

// TaskReworkRequest records a change request against a specific artifact
// revision. It is coordination input, not an execution receipt: the state
// returns to in_progress and stays unaccepted until a human accepts again.
type TaskReworkRequest struct {
	Project    string `json:"project"`
	TaskID     string `json:"task_id"`
	ArtifactID string `json:"artifact_id,omitempty"`
	Feedback   string `json:"feedback"`
}

func (r TaskArtifactRequest) validate() error {
	if strings.TrimSpace(r.Project) == "" || strings.TrimSpace(r.TaskID) == "" {
		return errors.New("project and task_id are required")
	}
	if r.Role != string(TaskArtifactInput) && r.Role != string(TaskArtifactOutput) {
		return errors.New("role must be input or output")
	}
	switch r.Kind {
	case "", "file", "image", "video", "audio", "link", "text":
	default:
		return errors.New("kind must be file, image, video, audio, link or text")
	}
	label := strings.TrimSpace(r.Label)
	// Source: same 1..60 character bound as a task title (PublicProgressRequest.Validate).
	if label == "" || utf8.RuneCountInString(label) > 60 {
		return errors.New("label must contain 1..60 characters")
	}
	ref := strings.TrimSpace(r.Ref)
	if ref == "" || strings.ContainsAny(ref, "\r\n\t") || !utf8.ValidString(ref) {
		return errors.New("ref must be a single valid line")
	}
	// Source: same 500-character public summary bound as a progress report.
	if utf8.RuneCountInString(strings.TrimSpace(r.Summary)) > 500 {
		return errors.New("summary must contain at most 500 characters")
	}
	return nil
}

func (r TaskReworkRequest) validate() error {
	if strings.TrimSpace(r.Project) == "" || strings.TrimSpace(r.TaskID) == "" {
		return errors.New("project and task_id are required")
	}
	feedback := strings.TrimSpace(r.Feedback)
	// Source: same 500-character public summary bound as a progress report.
	if feedback == "" || utf8.RuneCountInString(feedback) > 500 {
		return errors.New("feedback must contain 1..500 characters")
	}
	return nil
}

// RevisionNo is the task's current revision. Journals written before rework
// existed carry the zero value; they are the first revision.
func (t *Task) RevisionNo() int {
	if t.Revision < 1 {
		return 1
	}
	return t.Revision
}

// attachableTaskState reports whether more work may still be recorded. A human
// acceptance or a cancelled/failed end is final; starting over needs a new task.
func attachableTaskState(s TaskState) bool {
	switch s {
	case TaskStateReceived, TaskStateInProgress, TaskStateWaitingUser, TaskStateResultReady:
		return true
	}
	return false
}

// AttachArtifact records one artifact reference before acknowledging it. An
// identical retry at the same revision returns the stored artifact, so a
// resend does not duplicate history. Recording is not delivery: no card,
// message or thread id is created here.
func (p *PublicProgress) AttachArtifact(req TaskArtifactRequest) (*TaskArtifact, error) {
	if err := req.validate(); err != nil {
		return nil, err
	}
	if req.Project != p.project {
		return nil, errors.New("task is not active for this project")
	}
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.records[req.TaskID]
	p.mu.Unlock()
	if r == nil {
		return nil, errors.New("unknown task")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.record.Task
	if !attachableTaskState(t.State) {
		return nil, errors.New("a finished task cannot take new artifacts; record the change before it ends")
	}
	rev := t.RevisionNo()
	role := TaskArtifactRole(req.Role)
	kind := req.Kind
	if kind == "" {
		kind = "file"
	}
	label, ref := strings.TrimSpace(req.Label), strings.TrimSpace(req.Ref)
	summary := strings.TrimSpace(req.Summary)
	for i := range t.Artifacts {
		a := t.Artifacts[i]
		if a.Revision == rev && a.Role == role && a.Kind == kind && a.Label == label && a.Ref == ref && a.Summary == summary {
			cp := a
			return &cp, nil
		}
	}
	old := r.record.Task.Clone()
	t.Revision = rev
	a := TaskArtifact{
		ID:        fmt.Sprintf("%s:a%d", t.ID, len(t.Artifacts)+1),
		TaskID:    t.ID,
		Role:      role,
		Kind:      kind,
		Label:     label,
		Ref:       ref,
		Summary:   summary,
		Revision:  rev,
		CreatedAt: time.Now().UTC(),
	}
	t.Artifacts = append(t.Artifacts, a)
	t.UpdatedAt = a.CreatedAt
	if err := p.save(r); err != nil {
		r.record.Task = old
		return nil, err
	}
	return &a, nil
}

// Rework records the owner's change request against a revision and reopens the
// task for the next turn. Old artifacts and events stay; only the result
// summary that is about to become stale is cleared. A human acceptance is
// never withdrawn or simulated.
func (p *PublicProgress) Rework(req TaskReworkRequest) (*Task, error) {
	if err := req.validate(); err != nil {
		return nil, err
	}
	if req.Project != p.project {
		return nil, errors.New("task is not active for this project")
	}
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.records[req.TaskID]
	p.mu.Unlock()
	if r == nil {
		return nil, errors.New("unknown task")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.record.Task
	if r.record.Accepted || t.State == TaskStateCompleted {
		return nil, errors.New("an accepted task cannot be reworked; open a new task")
	}
	if !attachableTaskState(t.State) {
		return nil, errors.New("a cancelled or failed task cannot be reworked; open a new task")
	}
	target, err := reworkTarget(t, req.ArtifactID)
	if err != nil {
		return nil, err
	}
	old := r.record.Task.Clone()
	t.Revision = t.RevisionNo() + 1
	t.State = TaskStateInProgress
	t.ResultSummary = ""
	t.CompletedAt = nil
	summary := strings.TrimSpace(req.Feedback)
	detail := fmt.Sprintf("revision %d", t.Revision)
	if target != nil {
		detail = fmt.Sprintf("%s · artifact %s %s", detail, target.ID, target.Label)
	}
	p.appendEvent(r, TaskEventRequirementChanged, summary, true)
	// appendEvent writes Summary; Detail carries the revision/artifact binding.
	if target != nil {
		r.record.Task.Events[len(r.record.Task.Events)-1].Detail = detail
	}
	if err := p.save(r); err != nil {
		r.record.Task = old
		return nil, err
	}
	p.mu.Lock()
	p.pending[t.ID] = r
	p.indexRun(r)
	if !r.record.Auto && resumableTask(t, r.record.Accepted, time.Now()) {
		p.open[t.SessionKey] = r
	}
	p.mu.Unlock()
	return t.Clone(), nil
}

// reworkTarget resolves the artifact the change is about. With exactly one
// output artifact that one is unambiguous; with several the caller must name
// one, so the wrong deliverable's history is never rewritten by a guess.
func reworkTarget(t *Task, artifactID string) (*TaskArtifact, error) {
	if artifactID != "" {
		for i := range t.Artifacts {
			if t.Artifacts[i].ID == artifactID {
				cp := t.Artifacts[i]
				return &cp, nil
			}
		}
		return nil, errors.New("artifact does not belong to this task")
	}
	var outputs []TaskArtifact
	for i := range t.Artifacts {
		if t.Artifacts[i].Role == TaskArtifactOutput {
			outputs = append(outputs, t.Artifacts[i])
		}
	}
	switch len(outputs) {
	case 0:
		return nil, nil
	case 1:
		cp := outputs[0]
		return &cp, nil
	default:
		ids := make([]string, 0, len(outputs))
		for _, a := range outputs {
			ids = append(ids, a.ID)
		}
		return nil, fmt.Errorf("name the artifact to rework: %s", strings.Join(ids, ", "))
	}
}
