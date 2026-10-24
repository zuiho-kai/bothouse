package acp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: DSH rows carry the child's label as task, its preset as name
// and its current tool name as step; tool arguments and text never arrive.
func TestACPSubTasksLabelsAndStep(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	s := &acpSession{ctx: ctx, cancel: cancel, acpSessID: "parent", events: make(chan core.Event, 16)}
	r := any(s).(core.SubTaskReporter)
	emit := func(kind, run, status string, extra map[string]any) {
		meta := map[string]any{"id": "child", "runId": run, "status": status}
		for k, v := range extra {
			meta[k] = v
		}
		raw, _ := json.Marshal(map[string]any{"sessionId": "parent", "update": map[string]any{"sessionUpdate": kind, "toolCallId": "subagent/" + run, "_meta": map[string]any{"bothouse/subagent": meta}, "content": "PRIVATE"}})
		s.onNotification("session/update", raw)
	}
	emit("tool_call", "run-1", "running", map[string]any{"task": "审查登录修复", "name": "reviewer"})
	emit("tool_call_update", "run-1", "running", map[string]any{"step": "shell"})
	_, rows, _ := r.SubTasks()
	if len(rows) != 1 || rows[0].Description != "审查登录修复" || rows[0].Name != "reviewer" || rows[0].Step != "shell" {
		t.Fatalf("labels: %+v", rows)
	}
	// A stale run cannot change the step.
	emit("tool_call_update", "run-0", "running", map[string]any{"step": "PRIVATE"})
	emit("tool_call_update", "run-1", "completed", nil)
	_, rows, _ = r.SubTasks()
	b, _ := json.Marshal(rows)
	if rows[0].Status != core.SubTaskCompleted || rows[0].Step != "shell" || strings.Contains(string(b), "PRIVATE") {
		t.Fatalf("final: %s", b)
	}
}
