package acp

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestACPSubTasksNativeLifecycle(t *testing.T) {
	// A strict parent already finished its prompt. Background lifecycle still
	// belongs to this session; it is not replayable assistant output.
	ctx, cancel := context.WithCancel(context.Background())
	s := &acpSession{ctx: ctx, cancel: cancel, acpSessID: "parent", inputGuard: true, events: make(chan core.Event, 16)}
	r, ok := any(s).(core.SubTaskReporter)
	if !ok {
		t.Fatal("ACP does not report child-agent state")
	}
	emit := func(parent, id, run, status string) {
		kind := "tool_call_update"
		if status == "start" {
			kind = "tool_call"
			status = "running"
		}
		raw, _ := json.Marshal(map[string]any{"sessionId": parent, "update": map[string]any{"sessionUpdate": kind, "toolCallId": "tool-call-not-child", "_meta": map[string]any{"bothouse/subagent": map[string]any{"id": id, "runId": run, "status": status}}, "content": "PRIVATE"}})
		s.onNotification("session/update", raw)
	}
	emit("foreign", "child", "run-1", "start")
	_, rows, _ := r.SubTasks()
	if len(rows) != 0 {
		t.Fatal("foreign child accepted")
	}
	emit("parent", "child", "run-1", "start")
	emit("parent", "child", "run-1", "waiting")
	_, rows, _ = r.SubTasks()
	if len(rows) != 1 || rows[0].Status != core.SubTaskWaiting {
		t.Fatalf("idle not waiting: %+v", rows)
	}
	emit("parent", "child", "run-1", "running")
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskRunning {
		t.Fatal("running update ignored")
	}
	emit("parent", "child", "run-1", "completed")
	emit("parent", "child", "run-1", "start") // replay cannot resurrect completed run
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskCompleted {
		t.Fatal("duplicate resurrected run")
	}
	emit("parent", "child", "run-2", "start")
	emit("parent", "child", "run-1", "failed") // late old epoch cannot fail new activation
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskRunning || rows[0].ID != "child" {
		t.Fatalf("bad resumed child: %+v", rows)
	}
	emit("parent", "child", "run-2", "stopped")
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskStopped {
		t.Fatal("cancel shown as success")
	}
	if len(s.events) != 0 {
		t.Fatal("lifecycle produced public tool/private output")
	}
	emit("parent", "unfinished", "run-3", "start")
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskStopped {
		t.Fatal("close left unfinished child running")
	}
	for range r.SubTasksChanged() {
	}
}

func TestACPSubTasksOrdinaryToolDoesNotCreateChild(t *testing.T) {
	s := &acpSession{ctx: context.Background(), acpSessID: "parent", events: make(chan core.Event, 16)}
	s.onNotification("session/update", json.RawMessage("{\"sessionId\":\"parent\",\"update\":{\"sessionUpdate\":\"tool_call\",\"toolCallId\":\"call\",\"title\":\"subagent\",\"status\":\"in_progress\"}}"))
	r, ok := any(s).(core.SubTaskReporter)
	if !ok {
		t.Fatal("missing reporter")
	}
	_, rows, _ := r.SubTasks()
	if len(rows) != 0 {
		t.Fatal("guessed a child from tool name")
	}
}
