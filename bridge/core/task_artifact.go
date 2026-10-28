package core

import (
	"crypto/sha256"
	"encoding/json"
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
	// RequestID is the stable operation id for this attach. Reusing it returns
	// the artifact that operation recorded, even after a rework advanced the
	// task or the bridge restarted. A new deliverable uses a new id even when
	// every field (including the output path) is identical.
	RequestID string `json:"request_id,omitempty"`
	// Revision pins the task revision this attach was produced for. A retry
	// reuses its RequestID instead; a new attach names the revision the caller
	// is delivering for, so a late request cannot be silently attached to a
	// newer revision. Zero means the current revision.
	Revision int    `json:"revision,omitempty"`
	Role     string `json:"role"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	Ref      string `json:"ref"`
	Summary  string `json:"summary,omitempty"`
}

// TaskReworkRequest records a change request against a specific artifact
// revision. It is coordination input, not an execution receipt: the state
// returns to in_progress and stays unaccepted until a human accepts again.
type TaskReworkRequest struct {
	Project    string `json:"project"`
	TaskID     string `json:"task_id"`
	ArtifactID string `json:"artifact_id,omitempty"`
	// RequestID is the stable operation id for this change request. A retry of
	// the same user action must reuse it; the committed receipt (revision and
	// event) is returned instead of opening another revision. A new action uses
	// a new id even when its words are identical.
	RequestID string `json:"request_id"`
	Feedback  string `json:"feedback"`
}

func (r TaskArtifactRequest) validate() error {
	if strings.TrimSpace(r.Project) == "" || strings.TrimSpace(r.TaskID) == "" {
		return errors.New("project and task_id are required")
	}
	// Source: same 1..100 character bound as a rework request id, so one retry
	// token cannot grow unbounded.
	if id := strings.TrimSpace(r.RequestID); utf8.RuneCountInString(id) > 100 {
		return errors.New("request_id must contain at most 100 characters")
	}
	if r.Revision < 0 {
		return errors.New("revision must be positive when set")
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
	// Source: same 1..100 character bound as a relay request id (RelayRequest
	// validation) so one retry token cannot grow unbounded.
	if id := strings.TrimSpace(r.RequestID); id == "" || utf8.RuneCountInString(id) > 100 {
		return errors.New("request_id must contain 1..100 characters; reuse it when retrying one change request")
	}
	feedback := strings.TrimSpace(r.Feedback)
	// Source: same 500-character public summary bound as a progress report.
	if feedback == "" || utf8.RuneCountInString(feedback) > 500 {
		return errors.New("feedback must contain 1..500 characters")
	}
	return nil
}

// taskReworkRecord binds one stable rework request id to the revision and event
// it produced. It is stored with the task journal (like a relay receipt), so a
// lost acknowledgement after a restart returns the committed operation instead
// of opening a second revision.
type taskReworkRecord struct {
	Hash       string    `json:"hash"`
	ArtifactID string    `json:"artifact_id,omitempty"`
	Feedback   string    `json:"feedback"`
	Revision   int       `json:"revision"`
	Seq        int64     `json:"seq"`
	EventID    string    `json:"event_id,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// TaskReworkReceipt is the stable, caller-visible receipt of one rework
// operation. The first call and every retry return the same binding, so a
// caller can name its own revision, event and target even when a newer request
// has already advanced the task.
type TaskReworkReceipt struct {
	RequestID  string    `json:"request_id"`
	TaskID     string    `json:"task_id"`
	ArtifactID string    `json:"artifact_id,omitempty"`
	Feedback   string    `json:"feedback"`
	Revision   int       `json:"revision"`
	Seq        int64     `json:"seq"`
	EventID    string    `json:"event_id,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

func (rec taskReworkRecord) receipt(requestID, taskID string) TaskReworkReceipt {
	return TaskReworkReceipt{
		RequestID:  requestID,
		TaskID:     taskID,
		ArtifactID: rec.ArtifactID,
		Feedback:   rec.Feedback,
		Revision:   rec.Revision,
		Seq:        rec.Seq,
		EventID:    rec.EventID,
		CreatedAt:  rec.CreatedAt,
	}
}

// TaskReworkResult is the current task snapshot plus the receipt of the
// operation that handled the call. The task may already be at a newer revision
// when another request arrived first; the receipt still names the caller's own
// operation, so the response is never a rollback of the current task.
type TaskReworkResult struct {
	*Task
	Receipt TaskReworkReceipt `json:"receipt"`
}

// taskArtifactRecord binds one stable attach operation id to the artifact it
// recorded. Stored with the task journal so a lost acknowledgement returns the
// original artifact instead of attaching it again at the current revision.
type taskArtifactRecord struct {
	Hash       string `json:"hash"`
	ArtifactID string `json:"artifact_id"`
	Revision   int    `json:"revision"`
}

// artifactRequestHash is the content identity of one attach operation. The
// task id and every recorded field are included; the revision is not, because
// a retry may arrive after a newer revision was opened.
func artifactRequestHash(req TaskArtifactRequest) string {
	b, _ := json.Marshal([]string{
		strings.TrimSpace(req.TaskID),
		strings.TrimSpace(req.Role),
		strings.TrimSpace(req.Kind),
		strings.TrimSpace(req.Label),
		strings.TrimSpace(req.Ref),
		strings.TrimSpace(req.Summary),
	})
	return fmt.Sprintf("%x", sha256.Sum256(b))
}

// reworkRequestHash is the content identity of one operation. It deliberately
// includes the task and named artifact, so a reused request id with different
// words or a different target is a conflict, not a retry.
func reworkRequestHash(req TaskReworkRequest) string {
	b, _ := json.Marshal([]string{strings.TrimSpace(req.TaskID), strings.TrimSpace(req.ArtifactID), strings.TrimSpace(req.Feedback)})
	return fmt.Sprintf("%x", sha256.Sum256(b))
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

// AttachArtifact records one artifact reference before acknowledging it. The
// operation is identified by RequestID: an identical retry returns the stored
// artifact at its original revision, even after a rework or a restart. Without
// an id the only retry scope is the current revision, so an identical attach
// after a revision bump is a new deliverable rather than the old operation
// rebound. Recording is not delivery: no card, message or thread is created.
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
	role := TaskArtifactRole(req.Role)
	kind := req.Kind
	if kind == "" {
		kind = "file"
	}
	label, ref := strings.TrimSpace(req.Label), strings.TrimSpace(req.Ref)
	summary := strings.TrimSpace(req.Summary)
	requestID := strings.TrimSpace(req.RequestID)
	hash := artifactRequestHash(req)
	// A committed retry is answered before the state check: a lost ACK must
	// still see the artifact it recorded, even if the task later advanced or a
	// human accepted it. Same id with different content is a conflict.
	if requestID != "" {
		if rec, ok := r.record.ArtifactRequests[requestID]; ok {
			if rec.Hash != hash {
				return nil, errors.New("artifact request_id reused with different content")
			}
			if stored := artifactByID(t, rec.ArtifactID); stored != nil {
				cp := *stored
				return &cp, nil
			}
			return nil, fmt.Errorf("artifact receipt %s refers to missing artifact %s", requestID, rec.ArtifactID)
		}
	}
	if !attachableTaskState(t.State) {
		return nil, errors.New("a finished task cannot take new artifacts; record the change before it ends")
	}
	rev := t.RevisionNo()
	// An explicit revision is a promise about what the caller is delivering
	// for. A stale number is refused instead of being attached to the newer
	// current revision; the retry path above is the way to replay an old
	// operation.
	if req.Revision != 0 && req.Revision != rev {
		return nil, fmt.Errorf("artifact revision %d is not the current revision %d; a new attach names the current revision and a retry reuses its request_id", req.Revision, rev)
	}
	// Without an operation id, identical fields are only a retry of the same
	// operation while the revision has not changed. After a rework the user
	// commonly writes the new version to the same path with the same label,
	// and that is a new deliverable.
	for i := range t.Artifacts {
		a := t.Artifacts[i]
		if a.Revision == rev && a.Role == role && a.Kind == kind && a.Label == label && a.Ref == ref && a.Summary == summary {
			cp := a
			return &cp, nil
		}
	}
	old := r.record.Task.Clone()
	oldRequests := r.record.ArtifactRequests
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
	if requestID != "" {
		requests := make(map[string]taskArtifactRecord, len(oldRequests)+1)
		for id, rec := range oldRequests {
			requests[id] = rec
		}
		requests[requestID] = taskArtifactRecord{Hash: hash, ArtifactID: a.ID, Revision: rev}
		r.record.ArtifactRequests = requests
	}
	if err := p.save(r); err != nil {
		r.record.Task = old
		r.record.ArtifactRequests = oldRequests
		return nil, err
	}
	return &a, nil
}

// artifactByID finds one recorded artifact by its stable id.
func artifactByID(t *Task, id string) *TaskArtifact {
	for i := range t.Artifacts {
		if t.Artifacts[i].ID == id {
			return &t.Artifacts[i]
		}
	}
	return nil
}

// Rework records the owner's change request against a revision and reopens the
// task for the next turn. Old artifacts and events stay; only the result
// summary that is about to become stale is cleared. A human acceptance is
// never withdrawn or simulated. The result always carries the receipt of this
// operation, on the first call and on every retry, while Task stays the
// current snapshot.
func (p *PublicProgress) Rework(req TaskReworkRequest) (*TaskReworkResult, error) {
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
	// A committed retry is recognised before the current state, so a lost ACK
	// is answered even if the task was later accepted or advanced. Same id with
	// different content is a conflict; the same words under a new id are a new
	// request and open a new revision below.
	hash := reworkRequestHash(req)
	if receipt, ok := r.record.Reworks[req.RequestID]; ok {
		if receipt.Hash != hash {
			return nil, errors.New("rework request_id reused with different content")
		}
		return &TaskReworkResult{Task: t.Clone(), Receipt: receipt.receipt(req.RequestID, t.ID)}, nil
	}
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
	event := r.record.Task.Events[len(r.record.Task.Events)-1]
	artifactID := ""
	if target != nil {
		artifactID = target.ID
	}
	oldReworks := r.record.Reworks
	reworks := make(map[string]taskReworkRecord, len(oldReworks)+1)
	for id, rec := range oldReworks {
		reworks[id] = rec
	}
	record := taskReworkRecord{
		Hash:       hash,
		ArtifactID: artifactID,
		Feedback:   summary,
		Revision:   t.Revision,
		Seq:        event.Seq,
		EventID:    event.ID,
		CreatedAt:  time.Now().UTC(),
	}
	reworks[req.RequestID] = record
	r.record.Reworks = reworks
	if err := p.save(r); err != nil {
		r.record.Task = old
		r.record.Reworks = oldReworks
		return nil, err
	}
	p.mu.Lock()
	p.pending[t.ID] = r
	p.indexRun(r)
	if !r.record.Auto && resumableTask(t, r.record.Accepted, time.Now()) {
		p.open[t.SessionKey] = r
	}
	p.mu.Unlock()
	return &TaskReworkResult{Task: t.Clone(), Receipt: record.receipt(req.RequestID, t.ID)}, nil
}

// reworkTarget resolves the artifact the change is about. It only ever names a
// deliverable output: an input is kept as history and cannot be the target, so
// naming one is refused instead of silently rewriting the user's material.
func reworkTarget(t *Task, artifactID string) (*TaskArtifact, error) {
	if artifactID != "" {
		for i := range t.Artifacts {
			if t.Artifacts[i].ID == artifactID {
				if t.Artifacts[i].Role != TaskArtifactOutput {
					return nil, fmt.Errorf("artifact %s is input material; rework names an output deliverable", artifactID)
				}
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
