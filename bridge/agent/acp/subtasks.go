package acp

import (
	"encoding/json"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

const subTaskMetaKey = "bothouse/subagent"

var _ core.SubTaskReporter = (*acpSession)(nil)

type subTaskRuns struct {
	mu      sync.Mutex
	current map[string]string
	seen    map[string]bool
}

// The DSH integration forwards native lifecycle edges in standard ACP tool
// updates' _meta. They are not ordinary tool calls. Parent session and run IDs
// isolate siblings, background updates and repeated activations of one child.
func (s *acpSession) handleSubTaskUpdate(raw json.RawMessage) bool {
	var n struct {
		SessionID string `json:"sessionId"`
		Update    struct {
			SessionUpdate string                     `json:"sessionUpdate"`
			Meta          map[string]json.RawMessage `json:"_meta"`
		} `json:"update"`
	}
	if json.Unmarshal(raw, &n) != nil {
		return false
	}
	meta, ok := n.Update.Meta[subTaskMetaKey]
	if !ok {
		return false
	}
	if n.SessionID == "" || n.SessionID != s.currentACPSessionID() {
		return true
	}
	if n.Update.SessionUpdate != "tool_call" && n.Update.SessionUpdate != "tool_call_update" {
		return true
	}
	// name/task/step are optional public labels (DSH: child label from its
	// subagent/descriptor, current tool name); never prompts or tool arguments.
	var edge struct{ ID, RunID, Status, Name, Task, Step string }
	if json.Unmarshal(meta, &edge) != nil || edge.ID == "" || edge.RunID == "" {
		return true
	}
	var status core.SubTaskStatus
	switch edge.Status {
	case "running":
		status = core.SubTaskRunning
	case "waiting":
		status = core.SubTaskWaiting
	case "completed":
		status = core.SubTaskCompleted
	case "failed":
		status = core.SubTaskFailed
	case "stopped":
		status = core.SubTaskStopped
	default:
		return true
	}
	r := &s.subTaskRuns
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.current == nil {
		r.current = map[string]string{}
		r.seen = map[string]bool{}
	}
	started := status == core.SubTaskRunning && n.Update.SessionUpdate == "tool_call"
	if started {
		if r.seen[edge.RunID] {
			return true
		}
		r.seen[edge.RunID] = true
		r.current[edge.ID] = edge.RunID
	} else if r.current[edge.ID] != edge.RunID {
		return true
	}
	s.UpdateSubTask(core.SubTask{ID: edge.ID, Status: status, ModeUnknown: true}, started)
	s.DescribeSubTask(edge.ID, core.SubTaskInfo{Name: strings.TrimSpace(edge.Name), Description: strings.TrimSpace(edge.Task), Step: strings.TrimSpace(edge.Step)})
	return true
}
