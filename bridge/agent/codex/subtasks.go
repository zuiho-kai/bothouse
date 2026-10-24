package codex

import (
	"encoding/json"
	"fmt"
	"path"
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
	if method == "thread/started" {
		// Observe only: the thread's own start stays with the normal handler.
		s.describeChildThread(raw)
		return false
	}
	if json.Unmarshal(raw, &n) != nil || n.ThreadID == "" || n.ThreadID == s.CurrentSessionID() || !s.HasSubTask(n.ThreadID) {
		return false
	}
	if method == "item/started" {
		var item struct {
			Item map[string]any `json:"item"`
		}
		if json.Unmarshal(raw, &item) == nil {
			if step := codexChildStep(item.Item); step != "" {
				s.DescribeSubTask(n.ThreadID, core.SubTaskInfo{Step: step})
			}
		}
		return true
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

// describeChildThread records a spawned child's public labels from its
// thread/started notification: the agent nickname (or role) as its name and
// the spawn's task_name (the last segment of agent_path) as its task. The
// thread preview is the child's prompt and is never read.
func (s *appServerSession) describeChildThread(raw json.RawMessage) {
	var n struct {
		Thread struct {
			ID             string `json:"id"`
			Name           string `json:"name"`
			AgentNickname  string `json:"agentNickname"`
			AgentRole      string `json:"agentRole"`
			ParentThreadID string `json:"parentThreadId"`
			Source         struct {
				SubAgent struct {
					ThreadSpawn struct {
						AgentNickname  string `json:"agent_nickname"`
						AgentRole      string `json:"agent_role"`
						AgentPath      any    `json:"agent_path"`
						ParentThreadID string `json:"parent_thread_id"`
					} `json:"thread_spawn"`
				} `json:"subAgent"`
			} `json:"source"`
		} `json:"thread"`
	}
	if json.Unmarshal(raw, &n) != nil {
		return
	}
	th := n.Thread
	spawn := th.Source.SubAgent.ThreadSpawn
	if th.ID == "" || th.ID == s.CurrentSessionID() || (th.ParentThreadID == "" && spawn.ParentThreadID == "") {
		return
	}
	name := firstNonEmpty(th.AgentNickname, spawn.AgentNickname, th.AgentRole, spawn.AgentRole)
	task := strings.TrimSpace(th.Name)
	if task == "" {
		if path, ok := spawn.AgentPath.(string); ok {
			task = path[strings.LastIndex(path, "/")+1:]
		}
	}
	s.DescribeSubTask(th.ID, core.SubTaskInfo{Name: strings.TrimSpace(name), Description: strings.TrimSpace(task)})
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// codexChildStep names what a child is doing from its item/started, at the
// same grain as Claude's task_progress. Only the kind of work and a file or
// tool name appear: no command line, arguments, reasoning or message text.
func codexChildStep(item map[string]any) string {
	typ, _ := item["type"].(string)
	switch typ {
	case "commandExecution":
		if actions, _ := item["commandActions"].([]any); len(actions) > 0 {
			if a, _ := actions[0].(map[string]any); a != nil {
				switch a["type"] {
				case "read":
					if name, _ := a["name"].(string); name != "" {
						return "Reading " + path.Base(name)
					}
					return "Reading files"
				case "listFiles":
					return "Listing files"
				case "search":
					return "Searching files"
				}
			}
		}
		return "Running command"
	case "fileChange":
		changes, _ := item["changes"].([]any)
		var first string
		if len(changes) > 0 {
			if c, _ := changes[0].(map[string]any); c != nil {
				first, _ = c["path"].(string)
			}
		}
		if first == "" {
			return "Editing files"
		}
		step := "Editing " + path.Base(first)
		if len(changes) > 1 {
			step += fmt.Sprintf(" +%d", len(changes)-1)
		}
		return step
	case "mcpToolCall":
		server, _ := item["server"].(string)
		tool, _ := item["tool"].(string)
		if server != "" && tool != "" {
			return "Calling " + server + "." + tool
		}
		return "Calling tool"
	case "dynamicToolCall":
		if tool, _ := item["tool"].(string); tool != "" {
			return "Calling " + tool
		}
		return "Calling tool"
	case "webSearch":
		return "Searching the web"
	}
	return ""
}
