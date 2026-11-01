package core

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
	ID                 string       `json:"id"`
	Title              string       `json:"title"`
	Agent              string       `json:"agent"`
	AssignedProject    string       `json:"assigned_project,omitempty"`
	Origin             string       `json:"origin"` // "voice" / "discord"
	SessionKey         string       `json:"session_key"`
	State              TaskState    `json:"state"`
	FactStage          FactStage    `json:"fact_stage"`
	RequiredSummary    string       `json:"required_summary,omitempty"`
	LatestProgress     string       `json:"latest_progress,omitempty"`
	ResultSummary      string       `json:"result_summary,omitempty"`
	VerificationResult string       `json:"verification_result,omitempty"`
	DeliverableURL     string       `json:"deliverable_url,omitempty"`
	NextSteps          string       `json:"next_steps,omitempty"`
	ChannelID          string       `json:"channel_id,omitempty"`
	MessageID          string       `json:"message_id,omitempty"`
	CardURL            string       `json:"card_url,omitempty"` // platform-generated permalink, never supplied by a progress report
	ThreadID           string       `json:"thread_id,omitempty"`
	ThreadTitle        string       `json:"thread_title,omitempty"` // name last given to the thread; it follows Title
	ThreadArchivedAt   *time.Time   `json:"thread_archived_at,omitempty"`
	Seq                int64        `json:"seq"`
	CreatedAt          time.Time    `json:"created_at"`
	UpdatedAt          time.Time    `json:"updated_at"`
	CompletedAt        *time.Time   `json:"completed_at,omitempty"`
	FinalNotified      bool         `json:"final_notified"`
	Events             []TaskEvent  `json:"events,omitempty"`
	Members            []TaskMember `json:"members,omitempty"`

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

// cardSessionKey is the channel that holds the task card: the execution
// workspace for a chat-channel source, else the source session.
func (t *Task) cardSessionKey() string {
	if t.CardSession != "" {
		return t.CardSession
	}
	return t.SessionKey
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

// IsTerminalState reports a verified completion, failure or cancellation.
// ResultReady is deliberately distinct from project acceptance.
func IsTerminalState(state TaskState) bool {
	return state == TaskStateCompleted || state == TaskStateFailed || state == TaskStateCancelled
}
