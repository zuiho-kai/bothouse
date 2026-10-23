package codex

import (
	"encoding/json"
	"sort"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.SubTaskReporter = (*codexSession)(nil)
var _ core.SubTaskReporter = (*appServerSession)(nil)

type subTaskTracker struct {
	core.SubTaskTracker
	starts      sync.Map          // native tool/turn IDs already used to reopen a child
	lifecycleMu sync.Mutex        // orders activation bookkeeping with table updates
	turns       map[string]string // current native turn per child
	ended       map[string]bool   // completed turn identities, including late arrivals
	observed    map[collaborationObservation]bool
}

type collaborationObservation struct {
	callID, tool, childID, callStatus string
	status                            core.SubTaskStatus
}

func (t *subTaskTracker) firstStart(id string) bool {
	if id == "" {
		return false
	}
	_, seen := t.starts.LoadOrStore(id, struct{}{})
	return !seen
}

// Both transports carry the same collaboration record, with different casing.
// Only receiver IDs and native agent states are public; prompts, messages and
// the collaboration tool's own ID/status never become child rows.
func updateCollaborationSubTasks(table *subTaskTracker, item map[string]any) {
	tool, _ := item["tool"].(string)
	tool = strings.ToLower(strings.ReplaceAll(tool, "_", ""))
	switch tool {
	case "spawnagent", "wait", "waitagent", "sendinput", "resumeagent", "closeagent", "sendmessage", "followuptask", "interruptagent", "listagents":
	default:
		return
	}
	table.lifecycleMu.Lock()
	defer table.lifecycleMu.Unlock()
	states, _ := item["agentsStates"].(map[string]any)
	if states == nil {
		states, _ = item["agents_states"].(map[string]any)
	}
	ids, _ := item["receiverThreadIds"].([]any)
	if ids == nil {
		ids, _ = item["receiver_thread_ids"].([]any)
	}
	// listAgents may report identities only as state-map keys.
	seen := map[string]bool{}
	for _, raw := range ids {
		if id, ok := raw.(string); ok {
			seen[id] = true
		}
	}
	var extra []string
	for id := range states {
		if !seen[id] {
			extra = append(extra, id)
		}
	}
	sort.Strings(extra)
	for _, id := range extra {
		ids = append(ids, id)
	}
	sender, _ := item["senderThreadId"].(string)
	if sender == "" {
		sender, _ = item["sender_thread_id"].(string)
	}
	callID, _ := item["id"].(string)
	callStatus, _ := item["status"].(string)
	activates := tool == "resumeagent" || tool == "sendinput" || tool == "followuptask"
	for _, raw := range ids {
		id, _ := raw.(string)
		if id == "" || id == sender {
			continue
		}
		state, _ := states[id].(map[string]any)
		status, _ := state["status"].(string)
		mapped, ok := codexSubTaskStatus(status)
		if !ok {
			// A successful spawn with a real child ID establishes a running
			// child, but a returned wait/send/close does not prove its state.
			callStatus, _ := item["status"].(string)
			if tool != "spawnagent" || callStatus != "completed" || state != nil {
				continue
			}
			mapped = core.SubTaskRunning
		}
		if callID != "" {
			if table.observed == nil {
				table.observed = make(map[collaborationObservation]bool)
			}
			observation := collaborationObservation{callID, tool, id, callStatus, mapped}
			if table.observed[observation] {
				continue
			}
			table.observed[observation] = true
		}
		// Consume every accepted dispatch identity, including terminal
		// observations, so a delayed replay cannot reopen a finished child.
		restart := false
		if activates && callStatus == "completed" && callID != "" {
			restart = table.firstStart("dispatch:" + callID + ":" + id)
		}
		if restart && mapped == core.SubTaskRunning {
			if turn := table.turns[id]; turn != "" && table.ended["turn:"+id+":"+turn] {
				delete(table.turns, id)
			}
		}
		table.UpdateSubTask(core.SubTask{ID: id, Status: mapped, ModeUnknown: true}, restart && mapped == core.SubTaskRunning)
	}
}

func codexSubTaskStatus(status string) (core.SubTaskStatus, bool) {
	switch strings.ToLower(strings.ReplaceAll(status, "_", "")) {
	case "pendinginit", "running":
		return core.SubTaskRunning, true
	case "completed":
		return core.SubTaskCompleted, true
	case "errored":
		return core.SubTaskFailed, true
	case "interrupted", "shutdown", "notfound":
		return core.SubTaskStopped, true
	default:
		return "", false
	}
}

// Observe known children's turns before the parent-only output guard. Never
// forward child text or let a child turn finish the parent's turn.
func (s *appServerSession) handleChildNotification(method string, raw json.RawMessage) bool {
	var n struct {
		ThreadID string `json:"threadId"`
		Turn     struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"turn"`
		Status struct {
			Type        string   `json:"type"`
			ActiveFlags []string `json:"activeFlags"`
		} `json:"status"`
	}
	if json.Unmarshal(raw, &n) != nil || n.ThreadID == "" || n.ThreadID == s.CurrentSessionID() || !s.HasSubTask(n.ThreadID) {
		return false
	}
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.turns == nil {
		s.turns = make(map[string]string)
		s.ended = make(map[string]bool)
	}
	var status core.SubTaskStatus
	switch method {
	case "turn/started":
		if n.Turn.ID == "" || !s.firstStart("turn:"+n.ThreadID+":"+n.Turn.ID) {
			return true
		}
		if current := s.turns[n.ThreadID]; current != "" && !s.ended["turn:"+n.ThreadID+":"+current] {
			_, rows, _ := s.SubTasks()
			for _, row := range rows {
				if row.ID == n.ThreadID && row.Live() {
					// A thread has one active turn. A different start cannot
					// displace it before its native result is observed.
					return true
				}
			}
		}
		s.turns[n.ThreadID] = n.Turn.ID
		status = core.SubTaskRunning
	case "turn/completed":
		key := "turn:" + n.ThreadID + ":" + n.Turn.ID
		if n.Turn.ID != "" {
			if s.ended[key] {
				return true
			}
			s.ended[key] = true
			s.starts.Store(key, struct{}{})
		}
		// A completion without identity cannot settle a tracked turn.
		if current := s.turns[n.ThreadID]; current != "" && current != n.Turn.ID {
			return true
		}
		switch n.Turn.Status {
		case "completed":
			status = core.SubTaskCompleted
		case "failed":
			status = core.SubTaskFailed
		case "interrupted":
			status = core.SubTaskStopped
		default:
			return true
		}
	case "thread/status/changed":
		if n.Status.Type != "active" {
			// Idle alone is not a successful child result.
			return true
		}
		status = core.SubTaskRunning
		for _, flag := range n.Status.ActiveFlags {
			if flag == "waitingOnApproval" || flag == "waitingOnUserInput" {
				status = core.SubTaskWaiting
			}
		}
	default:
		return true
	}
	s.UpdateSubTask(core.SubTask{ID: n.ThreadID, Status: status, ModeUnknown: true}, method == "turn/started")
	return true
}
