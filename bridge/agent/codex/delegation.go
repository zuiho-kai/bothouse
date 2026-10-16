package codex

import "github.com/chenhg5/cc-connect/core"

// Collaboration items contain private prompts and child responses. Publish only
// known tool identifiers and lifecycle status, never the nested payload. A
// completed wait call means the call returned, not that its children succeeded.
func (cs *codexSession) handleCollaboration(item map[string]any, completed bool) {
	tool, _ := item["tool"].(string)
	switch tool {
	case "spawn_agent", "wait", "wait_agent", "send_input", "resume_agent", "close_agent":
	default:
		return
	}
	event := core.Event{Type: core.EventToolUse, ToolName: tool}
	if completed {
		event.Type = core.EventToolResult
		status, _ := item["status"].(string)
		switch status {
		case "completed", "failed", "cancelled":
			event.ToolStatus = status
			success := status == "completed"
			event.ToolSuccess = &success
		}
	}
	select {
	case cs.events <- event:
	case <-cs.ctx.Done():
	}
}
