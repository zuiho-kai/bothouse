package codex

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: Codex child rows carry a name, a task and the current step like
// Claude rows, and none of them comes from the prompt, reasoning, replies or
// the command line.
func TestCodexSubTasksNameTaskAndStep(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	s := &appServerSession{ctx: ctx, cancel: cancel, events: make(chan core.Event, 16)}
	s.threadID.Store("parent")
	r := reporter(t, s)
	// The child's own thread/started may precede the parent's spawn record.
	s.handleNotification("thread/started", json.RawMessage(`{"thread":{"id":"child","agentNickname":"Ramanujan","agentRole":"worker","preview":"PRIVATE_PROMPT","source":{"subAgent":{"thread_spawn":{"parent_thread_id":"parent","depth":1,"agent_path":"/root/fix_login_bug"}}}}}`))
	s.handleItemCompleted(map[string]any{"type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed", "senderThreadId": "parent", "receiverThreadIds": []any{"child"}, "prompt": "PRIVATE_PROMPT"})
	_, rows, _ := r.SubTasks()
	if len(rows) != 1 || rows[0].Name != "Ramanujan" || rows[0].Description != "fix_login_bug" {
		t.Fatalf("name/task: %+v", rows)
	}
	child := func(item string) {
		s.handleNotification("item/started", json.RawMessage(`{"threadId":"child","item":`+item+`}`))
	}
	child(`{"type":"commandExecution","command":"PRIVATE_CMD --token x","commandActions":[{"type":"unknown","command":"PRIVATE_CMD"}]}`)
	if _, rows, _ = r.SubTasks(); rows[0].Step != "Running command" {
		t.Fatalf("command step: %q", rows[0].Step)
	}
	child(`{"type":"reasoning","summary":["PRIVATE_THOUGHT"]}`)
	child(`{"type":"agentMessage","text":"PRIVATE_REPLY"}`)
	if _, rows, _ = r.SubTasks(); rows[0].Step != "Running command" {
		t.Fatalf("reasoning/reply changed step: %q", rows[0].Step)
	}
	child(`{"type":"fileChange","changes":[{"path":"/w/PRIVATEDIR/main.go","diff":"PRIVATE_DIFF"},{"path":"/w/b.go"}]}`)
	if _, rows, _ = r.SubTasks(); rows[0].Step != "Editing main.go +1" {
		t.Fatalf("edit step: %q", rows[0].Step)
	}
	// Unrelated threads never label or step a row.
	s.handleNotification("item/started", json.RawMessage(`{"threadId":"other","item":{"type":"webSearch","query":"PRIVATE"}}`))
	s.handleNotification("thread/started", json.RawMessage(`{"thread":{"id":"parent","agentNickname":"PRIVATE_SELF"}}`))
	_, rows, _ = r.SubTasks()
	b, _ := json.Marshal(rows)
	if strings.Contains(string(b), "PRIVATE") {
		t.Fatalf("private content in table: %s", b)
	}
	if len(s.events) != 1 { // only the parent's own collaboration tool event
		t.Fatalf("child items escaped as parent events: %d", len(s.events))
	}
	s.handleNotification("turn/completed", json.RawMessage(`{"threadId":"child","turn":{"status":"completed"}}`))
	child(`{"type":"webSearch"}`)
	if _, rows, _ = r.SubTasks(); rows[0].Status != core.SubTaskCompleted || rows[0].Step != "Editing main.go +1" {
		t.Fatalf("finished row: %+v", rows[0])
	}
}
