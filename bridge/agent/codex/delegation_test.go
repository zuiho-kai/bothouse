package codex

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestCollabToolCall_LifecycleWithoutPrivateContent(t *testing.T) {
	for _, tool := range []string{"spawn_agent", "wait", "wait_agent", "send_input", "resume_agent", "close_agent"} {
		t.Run(tool, func(t *testing.T) {
			cs := &codexSession{ctx: context.Background(), events: make(chan core.Event, 8)}
			item := map[string]any{"type": "collab_tool_call", "tool": tool, "status": "in_progress", "prompt": "PRIVATE_PROMPT", "receiver_thread_ids": []any{"PRIVATE_ID"}, "agents_states": map[string]any{"PRIVATE_ID": map[string]any{"status": "completed", "message": "PRIVATE_CHILD"}}}
			cs.handleItemStarted(map[string]any{"item": item})
			item["status"] = "completed"
			cs.handleItemCompleted(map[string]any{"item": item})
			if len(cs.events) != 2 {
				t.Fatalf("events = %d, want 2", len(cs.events))
			}
			start, end := <-cs.events, <-cs.events
			if start.Type != core.EventToolUse || start.ToolName != tool {
				t.Fatalf("bad start: %+v", start)
			}
			if end.Type != core.EventToolResult || end.ToolName != tool || end.ToolStatus != "completed" || end.ToolSuccess == nil || !*end.ToolSuccess {
				t.Fatalf("bad end: %+v", end)
			}
			b, _ := json.Marshal([]core.Event{start, end})
			if strings.Contains(string(b), "PRIVATE") {
				t.Fatalf("private collaboration payload leaked")
			}
		})
	}
}

func TestCollabToolCall_FailureAndUnknownPayload(t *testing.T) {
	cs := &codexSession{ctx: context.Background(), events: make(chan core.Event, 8)}
	cs.handleItemCompleted(map[string]any{"item": map[string]any{"type": "collab_tool_call", "tool": "spawn_agent", "status": "failed", "error": "PRIVATE_ERROR"}})
	if len(cs.events) != 1 {
		t.Fatal("missing failure event")
	}
	e := <-cs.events
	if e.ToolSuccess == nil || *e.ToolSuccess || e.ToolStatus != "failed" || e.ToolResult != "" {
		t.Fatalf("bad failure: %+v", e)
	}
	cs.handleItemCompleted(map[string]any{"item": map[string]any{"type": "collab_tool_call", "tool": "PRIVATE_UNKNOWN_TOOL", "status": "PRIVATE_STATUS"}})
	if len(cs.events) != 0 {
		t.Fatal("unrecognized tool must not be published")
	}
	cs.handleItemCompleted(map[string]any{"item": map[string]any{"type": "collab_tool_call", "tool": "wait", "status": "PRIVATE_STATUS"}})
	e = <-cs.events
	if e.ToolStatus != "" || e.ToolSuccess != nil {
		t.Fatalf("unknown status published or treated as success: %+v", e)
	}
}
