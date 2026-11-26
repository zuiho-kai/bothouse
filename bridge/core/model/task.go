// Package model holds the plain data types the platforms render (tasks,
// sub-agents, progress entries, team channels, moments). It imports nothing
// from core, so a platform can use them without depending on core's logic.
package model

import (
	"strings"
	"time"
)

// TaskState represents the execution lifecycle state of a task.
type TaskState string

const (
	TaskStateReceived    TaskState = "received"     // 已接收
	TaskStateInProgress  TaskState = "in_progress"  // 进行中
	TaskStateWaitingUser TaskState = "waiting_user" // 等你确认 / 等待用户
	TaskStateFailed      TaskState = "failed"       // 失败
	TaskStateCancelled   TaskState = "cancelled"    // 已取消
	TaskStateResultReady TaskState = "result_ready" // turn result, not project acceptance
	TaskStateCompleted   TaskState = "completed"    // 完成
)

// FactStage represents verifiable delivery progress facts.
// Strict separation: code modified != merged != deployed != verified.
type FactStage string

const (
	FactStageReceived     FactStage = "received"      // 任务已接纳
	FactStageCodeModified FactStage = "code_modified" // 代码已改
	FactStagePROpened     FactStage = "pr_opened"     // PR已提交
	FactStageCIPassed     FactStage = "ci_passed"     // CI自动测试通过
	FactStageMerged       FactStage = "merged"        // 已合并
	FactStageDeployed     FactStage = "deployed"      // 已部署
	FactStageVerified     FactStage = "verified"      // 真人已验收
)

// TaskEventKind categorizes task lifecycle events.
type TaskEventKind string

const (
	TaskEventCreated            TaskEventKind = "created"
	TaskEventRequirementChanged TaskEventKind = "requirement_changed"
	TaskEventProgress           TaskEventKind = "progress"
	TaskEventFactUpdated        TaskEventKind = "fact_updated"
	TaskEventWaitingUser        TaskEventKind = "waiting_user"
	TaskEventBlocked            TaskEventKind = "blocked"
	TaskEventFailed             TaskEventKind = "failed"
	TaskEventResultReady        TaskEventKind = "result_ready"
	TaskEventCompleted          TaskEventKind = "completed"
)

// TaskEvent records an audit entry for key task events.
type TaskEvent struct {
	ReporterProject string        `json:"reporter_project,omitempty"` // immutable sender selected when the public fact is recorded
	ID              string        `json:"id"`
	TaskID          string        `json:"task_id"`
	Seq             int64         `json:"seq"`
	Kind            TaskEventKind `json:"kind"`
	State           TaskState     `json:"state"`
	FactStage       FactStage     `json:"fact_stage"`
	Summary         string        `json:"summary"`
	Detail          string        `json:"detail,omitempty"`
	// Pointer marks a Summary that only points readers at the task thread
	// ("X 更新了进度，详见任务线程"); inside the thread it is noise.
	Pointer   bool      `json:"pointer,omitempty"`
	IsKeyFact bool      `json:"is_key_fact"`
	Timestamp time.Time `json:"timestamp"`
}

// ThreadText is the single text a task thread shows for this event: the
// reporter's own words when Summary only points at the thread, otherwise the
// summary followed by any detail.
func (ev TaskEvent) ThreadText() string {
	detail := strings.TrimSpace(ev.Detail)
	switch {
	case detail == "":
		return ev.Summary
	case ev.Pointer:
		return detail
	default:
		return ev.Summary + "\n" + detail
	}
}

// Task represents a persistent, trackable task unit with Discord card and thread bindings.
type Task struct {
	// ForumPost marks a task whose thread is the board-owned forum post; it is not renamed or archived by public progress.
	ForumPost          bool               `json:"forum_post,omitempty"`
	TextDeliveries     []TaskTextDelivery `json:"text_deliveries,omitempty"`
	ID                 string             `json:"id"`
	Title              string             `json:"title"`
	Agent              string             `json:"agent"`
	AssignedProject    string             `json:"assigned_project,omitempty"`
	Origin             string             `json:"origin"` // "voice" / "discord"
	SessionKey         string             `json:"session_key"`
	State              TaskState          `json:"state"`
	FactStage          FactStage          `json:"fact_stage"`
	RequiredSummary    string             `json:"required_summary,omitempty"`
	LatestProgress     string             `json:"latest_progress,omitempty"`
	ResultSummary      string             `json:"result_summary,omitempty"`
	VerificationResult string             `json:"verification_result,omitempty"`
	DeliverableURL     string             `json:"deliverable_url,omitempty"`
	NextSteps          string             `json:"next_steps,omitempty"`
	ChannelID          string             `json:"channel_id,omitempty"`
	MessageID          string             `json:"message_id,omitempty"`
	CardURL            string             `json:"card_url,omitempty"` // platform-generated permalink, never supplied by a progress report
	ThreadID           string             `json:"thread_id,omitempty"`
	ThreadTitle        string             `json:"thread_title,omitempty"` // name last given to the thread; it follows Title
	ThreadArchivedAt   *time.Time         `json:"thread_archived_at,omitempty"`
	Seq                int64              `json:"seq"`
	CreatedAt          time.Time          `json:"created_at"`
	UpdatedAt          time.Time          `json:"updated_at"`
	CompletedAt        *time.Time         `json:"completed_at,omitempty"`
	FinalNotified      bool               `json:"final_notified"`
	Events             []TaskEvent        `json:"events,omitempty"`
	Members            []TaskMember       `json:"members,omitempty"`

	// Revision starts at 1 and increases on each recorded rework; 0 in
	// journals written before rework existed (see RevisionNo).
	Revision  int            `json:"revision,omitempty"`
	Artifacts []TaskArtifact `json:"artifacts,omitempty"`
	// CardSession is the session key of the channel that holds the card when it
	// differs from SessionKey (a chat-channel source opens its card in the
	// execution workspace). Empty means the card lives in SessionKey.
	CardSession string `json:"card_session,omitempty"`

	AuthorizationDecisionID    string `json:"authorization_decision_id,omitempty"`
	AuthorizationNoticeVersion uint64 `json:"authorization_notice_version,omitempty"`
	AuthorizationWithdrawn     bool   `json:"authorization_withdrawn,omitempty"`
}

// Clone creates a deep copy of the task.
func (t *Task) Clone() *Task {
	if t == nil {
		return nil
	}
	cp := *t
	cp.Members = append([]TaskMember(nil), t.Members...)
	cp.Artifacts = append([]TaskArtifact(nil), t.Artifacts...)
	if t.CompletedAt != nil {
		tComplete := *t.CompletedAt
		cp.CompletedAt = &tComplete
	}
	if t.ThreadArchivedAt != nil {
		archived := *t.ThreadArchivedAt
		cp.ThreadArchivedAt = &archived
	}
	if len(t.Events) > 0 {
		cp.Events = make([]TaskEvent, len(t.Events))
		copy(cp.Events, t.Events)
	}
	return &cp
}

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

// RevisionNo is the task's current revision. Journals written before rework
// existed carry the zero value; they are the first revision.
func (t *Task) RevisionNo() int {
	if t.Revision < 1 {
		return 1
	}
	return t.Revision
}

// TaskMember is deliberately public. Capability tokens are kept only in memory.
// Assignment is not execution: StartedAt is set by the member's first report.
type TaskMember struct {
	ReporterProject string    `json:"reporter_project,omitempty"`
	ID              string    `json:"id"`
	ParentID        string    `json:"parent_id,omitempty"`
	Name            string    `json:"name"`
	Title           string    `json:"title"`
	Ref             string    `json:"ref,omitempty"`
	Base            string    `json:"base,omitempty"`
	Workspace       string    `json:"workspace,omitempty"` // execution workspace channel, "" = source workspace
	Status          string    `json:"status"`
	Summary         string    `json:"summary,omitempty"`
	AssignedAt      time.Time `json:"assigned_at"`
	StartedAt       time.Time `json:"started_at,omitempty"`
	UpdatedAt       time.Time `json:"updated_at"`
	EndedAt         time.Time `json:"ended_at,omitempty"`
}

func (m TaskMember) Live() bool {
	return m.Status == "queued" || m.Status == "running" || m.Status == "waiting"
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
