package model

import "time"

// SubTaskStatus is the state of one sub-agent row.
type SubTaskStatus string

const (
	SubTaskRunning SubTaskStatus = "running"
	// SubTaskWaiting: the sub-agent is idle but can resume (not done yet),
	// for example while waiting for its own background work or another input.
	SubTaskWaiting   SubTaskStatus = "waiting"
	SubTaskCompleted SubTaskStatus = "completed"
	SubTaskFailed    SubTaskStatus = "failed"
	SubTaskStopped   SubTaskStatus = "stopped"
)

// SubTask is one row of the sub-agent table.
type SubTask struct {
	ID          string        `json:"id"`
	Name        string        `json:"name,omitempty"` // who: Codex agent nickname / role; empty for Claude rows
	Description string        `json:"description"`
	ModeUnknown bool          `json:"mode_unknown,omitempty"` // backend does not expose foreground/background
	Background  bool          `json:"background,omitempty"`
	Step        string        `json:"step,omitempty"`    // what it is doing now (task_progress)
	Status      SubTaskStatus `json:"status"`            // running / completed / failed / stopped
	Summary     string        `json:"summary,omitempty"` // first sentence of the final report
	StartedAt   time.Time     `json:"started_at"`
	EndedAt     time.Time     `json:"ended_at,omitempty"`
}

// Running reports whether the sub-agent is working right now.
func (t SubTask) Running() bool { return t.Status == SubTaskRunning }

// Live reports whether the sub-agent has not finished yet: running, or
// waiting for its own background work.
func (t SubTask) Live() bool { return t.Status == SubTaskRunning || t.Status == SubTaskWaiting }
