package codex

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func reporter(t *testing.T, session any) core.SubTaskReporter {
	t.Helper()
	r, ok := session.(core.SubTaskReporter)
	if !ok {
		t.Fatal("session does not report child-agent state")
	}
	return r
}

func TestCodexSubTasksNativeLifecycle(t *testing.T) {
	for _, backend := range []string{"exec", "app_server"} {
		t.Run(backend, func(t *testing.T) {
			var session any
			var receive func(map[string]any, bool)
			ctx := context.Background()
			if backend == "exec" {
				s := &codexSession{ctx: ctx, events: make(chan core.Event, 16)}
				session = s
				receive = func(item map[string]any, done bool) {
					item["type"] = "collab_tool_call"
					if done {
						s.handleItemCompleted(map[string]any{"item": item})
					} else {
						s.handleItemStarted(map[string]any{"item": item})
					}
				}
			} else {
				s := &appServerSession{ctx: ctx, events: make(chan core.Event, 16)}
				session = s
				receive = func(item map[string]any, done bool) {
					item["type"] = "collabAgentToolCall"
					if done {
						s.handleItemCompleted(item)
					} else {
						s.handleItemStarted(item)
					}
				}
			}
			r := reporter(t, session)
			tool, idsKey, statesKey := "spawn_agent", "receiver_thread_ids", "agents_states"
			if backend == "app_server" {
				tool, idsKey, statesKey = "spawnAgent", "receiverThreadIds", "agentsStates"
			}
			item := map[string]any{"tool": tool, "id": "tool-call-not-child", "status": "completed", idsKey: []any{"child-1", "child-2"}, statesKey: map[string]any{"child-1": map[string]any{"status": "running", "message": "PRIVATE_CHILD"}, "child-2": map[string]any{"status": "running"}}, "prompt": "PRIVATE_PROMPT"}
			receive(item, true)
			_, rows, _ := r.SubTasks()
			if len(rows) != 2 || rows[0].ID != "child-1" || rows[0].Status != core.SubTaskRunning {
				t.Fatalf("spawn rows: %+v", rows)
			}
			// A successful wait without authoritative child states means no child completion.
			item["tool"] = "wait"
			delete(item, statesKey)
			receive(item, true)
			_, rows, _ = r.SubTasks()
			if rows[0].Status != core.SubTaskRunning {
				t.Fatal("wait return completed the child")
			}
			item[statesKey] = map[string]any{"child-1": map[string]any{"status": "completed", "message": "PRIVATE_RESULT"}, "child-2": map[string]any{"status": "errored"}}
			receive(item, true)
			gen, rows, _ := r.SubTasks()
			if gen != 1 || rows[0].Status != core.SubTaskCompleted || rows[1].Status != core.SubTaskFailed || rows[0].EndedAt.IsZero() {
				t.Fatalf("final rows: %+v", rows)
			}
			b, _ := json.Marshal(rows)
			if strings.Contains(string(b), "PRIVATE") || strings.Contains(string(b), "tool-call-not-child") {
				t.Fatal("private payload or tool ID leaked into table")
			}
			// Duplicate terminal updates do not create another generation.
			receive(item, true)
			again, _, _ := r.SubTasks()
			if again != gen {
				t.Fatal("duplicate changed generation")
			}
			// A later child starts a new table, keeping the old terminal snapshot.
			item["tool"] = tool
			item[idsKey] = []any{"child-3"}
			delete(item, statesKey)
			receive(item, true)
			next, rows, previous := r.SubTasks()
			if next != 2 || len(rows) != 1 || len(previous) != 2 {
				t.Fatalf("batch: %d %+v %+v", next, rows, previous)
			}
		})
	}
}

func TestCodexSubTasksChildTurnIsolationAndClose(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	s := &appServerSession{ctx: ctx, cancel: cancel, events: make(chan core.Event, 16)}
	s.threadID.Store("parent")
	s.handleItemCompleted(map[string]any{"type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed", "receiverThreadIds": []any{"child"}})
	r := reporter(t, s)
	// Only the parent's tool event should be public.
	<-s.events
	s.handleNotification("item/completed", json.RawMessage("{\"threadId\":\"child\",\"item\":{\"type\":\"agentMessage\",\"text\":\"PRIVATE\"}}"))
	s.handleNotification("turn/completed", json.RawMessage("{\"threadId\":\"unrelated\",\"turn\":{\"status\":\"completed\"}}"))
	_, rows, _ := r.SubTasks()
	if rows[0].Status != core.SubTaskRunning {
		t.Fatal("unrelated thread changed child")
	}
	s.handleNotification("turn/completed", json.RawMessage("{\"threadId\":\"child\",\"turn\":{\"status\":\"failed\"}}"))
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskFailed {
		t.Fatal("child failure lost")
	}
	if len(s.events) != 0 {
		t.Fatal("child output escaped parent isolation")
	}
	s.handleNotification("turn/started", json.RawMessage("{\"threadId\":\"child\",\"turn\":{\"id\":\"turn-2\",\"status\":\"inProgress\"}}"))
	s.handleNotification("turn/completed", json.RawMessage("{\"threadId\":\"child\",\"turn\":{\"id\":\"turn-2\",\"status\":\"completed\"}}"))
	s.handleNotification("turn/started", json.RawMessage("{\"threadId\":\"child\",\"turn\":{\"id\":\"turn-2\",\"status\":\"inProgress\"}}"))
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskCompleted {
		t.Fatal("duplicate turn start reopened completed child")
	}
	s.handleNotification("turn/started", json.RawMessage("{\"threadId\":\"child\",\"turn\":{\"id\":\"turn-3\",\"status\":\"inProgress\"}}"))
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskStopped {
		t.Fatalf("close left live child: %+v", rows)
	}
	for range r.SubTasksChanged() {
	}
}

func TestCodexSubTasksStateMapIdentityAndAcceptedClose(t *testing.T) {
	s := &appServerSession{ctx: context.Background(), events: make(chan core.Event, 16)}
	r := reporter(t, s)
	s.handleItemCompleted(map[string]any{"type": "collabAgentToolCall", "tool": "listAgents", "status": "completed", "senderThreadId": "parent", "agentsStates": map[string]any{"parent": map[string]any{"status": "running"}, "child": map[string]any{"status": "running"}}})
	_, rows, _ := r.SubTasks()
	if len(rows) != 1 || rows[0].ID != "child" {
		t.Fatalf("state map identities: %+v", rows)
	}
	s.handleItemCompleted(map[string]any{"type": "collabAgentToolCall", "tool": "closeAgent", "status": "completed", "receiverThreadIds": []any{"child"}})
	_, rows, _ = r.SubTasks()
	if rows[0].Status != core.SubTaskRunning {
		t.Fatal("accepted close fabricated terminal state")
	}
	s.handleItemStarted(map[string]any{"type": "collabAgentToolCall", "tool": "spawnAgent", "status": "inProgress", "prompt": "PRIVATE", "receiverThreadIds": []any{"not-established"}})
	_, rows, _ = r.SubTasks()
	if len(rows) != 1 {
		t.Fatal("spawn start fabricated a child")
	}
	for len(s.events) > 0 {
		ev := <-s.events
		if ev.ToolInput != "" || ev.ToolResult != "" {
			t.Fatalf("collaboration leaked content: %+v", ev)
		}
	}
}

func TestCodexSubTasksDuplicateResumePreservesResult(t *testing.T) {
	for _, backend := range []string{"exec", "app_server"} {
		t.Run(backend, func(t *testing.T) {
			var session any
			var receive func(map[string]any)
			toolKey, idsKey, statesKey := "resume_agent", "receiver_thread_ids", "agents_states"
			if backend == "exec" {
				s := &codexSession{ctx: context.Background(), events: make(chan core.Event, 16)}
				session = s
				receive = func(item map[string]any) { s.handleCollaboration(item, true) }
			} else {
				s := &appServerSession{ctx: context.Background(), events: make(chan core.Event, 16)}
				session = s
				toolKey, idsKey, statesKey = "resumeAgent", "receiverThreadIds", "agentsStates"
				receive = func(item map[string]any) { item["type"] = "collabAgentToolCall"; s.handleItemCompleted(item) }
			}
			r := reporter(t, session)
			state := func(tool, id, status string) {
				receive(map[string]any{"tool": tool, "id": id, "status": "completed", idsKey: []any{"child"}, statesKey: map[string]any{"child": map[string]any{"status": status}}})
			}
			state("wait", "wait-1", "completed")
			state(toolKey, "resume-1", "running")
			_, rows, _ := r.SubTasks()
			if rows[0].Status != core.SubTaskRunning {
				t.Fatal("new resume did not start child")
			}
			state("wait", "wait-2", "completed")
			state(toolKey, "resume-1", "running")
			state("wait", "close-1", "shutdown")
			_, rows, _ = r.SubTasks()
			if rows[0].Status != core.SubTaskCompleted {
				t.Fatal("duplicate resume or later shutdown overwrote result")
			}
			state(toolKey, "resume-2", "running")
			_, rows, _ = r.SubTasks()
			if rows[0].Status != core.SubTaskRunning {
				t.Fatal("new resume ID was ignored")
			}
		})
	}
}

func TestCodexSubTasksStaleTurnCompletesNewActivation(t *testing.T) {
	s := &appServerSession{ctx: context.Background(), events: make(chan core.Event, 20)}
	s.threadID.Store("parent")
	s.handleItemCompleted(map[string]any{"type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed", "receiverThreadIds": []any{"child"}})
	emit := func(method, turn, status string) {
		raw, _ := json.Marshal(map[string]any{"threadId": "child", "turn": map[string]any{"id": turn, "status": status}})
		s.handleNotification(method, raw)
	}
	emit("turn/started", "turn-1", "inProgress")
	emit("turn/completed", "turn-1", "completed")
	emit("turn/started", "turn-2", "inProgress")
	emit("turn/completed", "turn-1", "completed")
	emit("turn/completed", "older-unseen-turn", "failed")
	emit("turn/completed", "", "completed")
	_, rows, _ := s.SubTasks()
	if rows[0].Status != core.SubTaskRunning {
		t.Fatalf("old turn-1 completion changed active turn-2 to %s", rows[0].Status)
	}
	emit("turn/completed", "turn-2", "failed")
	_, rows, _ = s.SubTasks()
	if rows[0].Status != core.SubTaskFailed {
		t.Fatalf("turn-2 failure lost: %s", rows[0].Status)
	}
}
func TestCodexSubTasksSendInputRestartsCompletedChild(t *testing.T) {
	for _, tool := range []string{"send_input", "sendInput"} {
		s := &subTaskTracker{}
		s.UpdateSubTask(core.SubTask{ID: "child", Status: core.SubTaskCompleted}, false)
		item := map[string]any{"tool": tool, "id": "send-2", "status": "completed", "receiverThreadIds": []any{"child"}, "agentsStates": map[string]any{"child": map[string]any{"status": "running"}}}
		updateCollaborationSubTasks(s, item)
		_, rows, _ := s.SubTasks()
		if rows[0].Status != core.SubTaskRunning {
			t.Errorf("%s authoritative running state ignored: %s", tool, rows[0].Status)
		}
		s.UpdateSubTask(core.SubTask{ID: "child", Status: core.SubTaskCompleted}, false)
		updateCollaborationSubTasks(s, item)
		_, rows, _ = s.SubTasks()
		if rows[0].Status != core.SubTaskCompleted {
			t.Fatal("duplicate dispatch reopened a completed child")
		}
	}
}

func TestCodexSubTasksChildWaitingFlag(t *testing.T) {
	s := &appServerSession{ctx: context.Background(), events: make(chan core.Event, 20)}
	s.threadID.Store("parent")
	s.handleItemCompleted(map[string]any{"type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed", "receiverThreadIds": []any{"child"}})
	s.handleNotification("thread/status/changed", json.RawMessage(`{"threadId":"child","status":{"type":"active","activeFlags":["waitingOnApproval"]}}`))
	_, rows, _ := s.SubTasks()
	if rows[0].Status != core.SubTaskWaiting {
		t.Fatalf("native waitingOnApproval discarded: %s", rows[0].Status)
	}
	s.handleNotification("thread/status/changed", json.RawMessage(`{"threadId":"child","status":{"type":"active","activeFlags":[]}}`))
	_, rows, _ = s.SubTasks()
	if rows[0].Status != core.SubTaskRunning {
		t.Fatal("cleared waiting flags did not restore running")
	}
	s.handleNotification("thread/status/changed", json.RawMessage(`{"threadId":"child","status":{"type":"active","activeFlags":["waitingOnUserInput"]}}`))
	_, rows, _ = s.SubTasks()
	if rows[0].Status != core.SubTaskWaiting || !rows[0].ModeUnknown {
		t.Fatal("waiting for input was lost or given an invented execution mode")
	}
	s.handleNotification("turn/completed", json.RawMessage(`{"threadId":"child","turn":{"id":"turn-1","status":"completed"}}`))
	s.handleNotification("thread/status/changed", json.RawMessage(`{"threadId":"child","status":{"type":"active","activeFlags":[]}}`))
	_, rows, _ = s.SubTasks()
	if rows[0].Status != core.SubTaskCompleted {
		t.Fatal("late active status reopened terminal child")
	}
}

func TestCodexSubTasksDuplicateWaitDoesNotEndNewDispatch(t *testing.T) {
	s := &subTaskTracker{}
	item := func(tool, id, status string) map[string]any {
		return map[string]any{"tool": tool, "id": id, "status": "completed", "receiverThreadIds": []any{"child"}, "agentsStates": map[string]any{"child": map[string]any{"status": status}}}
	}
	updateCollaborationSubTasks(s, item("spawnAgent", "spawn-1", "running"))
	wait := item("wait", "wait-1", "completed")
	updateCollaborationSubTasks(s, wait)
	updateCollaborationSubTasks(s, item("sendInput", "send-2", "running"))
	updateCollaborationSubTasks(s, wait)
	_, rows, _ := s.SubTasks()
	if rows[0].Status != core.SubTaskRunning {
		t.Fatalf("duplicate wait-1 changed new send-2 to %s", rows[0].Status)
	}
}
func TestCodexSubTasksLateUnknownStartDoesNotReplaceCurrentTurn(t *testing.T) {
	s := &appServerSession{ctx: context.Background(), events: make(chan core.Event, 20)}
	s.threadID.Store("parent")
	s.handleItemCompleted(map[string]any{"type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed", "receiverThreadIds": []any{"child"}})
	emit := func(method, turn, status string) {
		raw, _ := json.Marshal(map[string]any{"threadId": "child", "turn": map[string]any{"id": turn, "status": status}})
		s.handleNotification(method, raw)
	}
	emit("turn/started", "current", "inProgress")
	emit("turn/started", "old-unseen", "inProgress")
	emit("turn/completed", "current", "failed")
	_, rows, _ := s.SubTasks()
	if rows[0].Status != core.SubTaskFailed {
		t.Fatalf("old start replaced current turn and dropped its failure: %s", rows[0].Status)
	}
}
