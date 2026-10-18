package antigravity

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestStreamSession_ReusesProcessAndSeparatesThoughts(t *testing.T) {
	if os.Getenv("CC_AGY_STREAM_TEST") == "1" {
		streamTestProcess()
		os.Exit(0)
	}
	agent, err := New(map[string]any{
		"cmd":      []string{os.Args[0], "-test.run=^TestStreamSession_ReusesProcessAndSeparatesThoughts$", "--"},
		"work_dir": t.TempDir(), "mode": "default", "stream_json": true,
		"env": map[string]any{"CC_AGY_STREAM_TEST": "1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	s, err := agent.StartSession(context.Background(), "resume-123")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for turn := 1; turn <= 2; turn++ {
		if err := s.Send(fmt.Sprintf("prompt-%d", turn), "msg", nil, nil); err != nil {
			t.Fatal(err)
		}
		var answer strings.Builder
		for {
			select {
			case ev := <-s.Events():
				if ev.Type == core.EventError {
					t.Fatal(ev.Error)
				}
				if ev.Type == core.EventText || ev.Type == core.EventResult {
					answer.WriteString(ev.Content)
				}
				if ev.Type == core.EventResult {
					want := fmt.Sprintf("answer-%d", turn)
					if answer.String() != want {
						t.Fatalf("answer = %q, want %q without thoughts or duplicate result", answer.String(), want)
					}
					if ev.SessionID != "resume-123" || !s.Alive() {
						t.Fatal("conversation/process did not survive the turn")
					}
					goto nextTurn
				}
			case <-time.After(3 * time.Second):
				t.Fatal("stream turn did not finish")
			}
		}
	nextTurn:
	}
}

func streamTestProcess() {
	args := strings.Join(os.Args, " ")
	if !strings.Contains(args, "--input-format stream-json") || !strings.Contains(args, "--conversation resume-123") || !strings.Contains(args, "--gemini_dir=") || strings.Contains(args, "--dangerously-skip-permissions") {
		fmt.Println(`{"event":"result","result":{"status":"ERROR","response":"missing stream/resume/permission arguments"}}`)
		return
	}
	fmt.Println(`{"event":"init","conversation_id":"resume-123"}`)
	scanner := bufio.NewScanner(os.Stdin)
	for turn := 1; scanner.Scan(); turn++ {
		switch os.Getenv("CC_AGY_STREAM_FAILURE") {
		case "exit":
			return
		case "malformed":
			fmt.Println("not-json")
			return
		case "timeout":
			time.Sleep(time.Hour)
			return
		}
		var input struct {
			Event   string `json:"event"`
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(scanner.Bytes(), &input) != nil || input.Event != "user" || !strings.HasSuffix(input.Message.Content, fmt.Sprintf("prompt-%d", turn)) || !strings.Contains(input.Message.Content, "model list --json") {
			fmt.Println(`{"event":"result","result":{"status":"ERROR","response":"prompt or process continuity lost"}}`)
			return
		}
		switch os.Getenv("CC_AGY_STREAM_FAILURE") {
		case "stall":
			fmt.Println(`{"event":"step_update","step_update":{"step_type":"thinking","text_delta":"thinking"}}`)
			time.Sleep(time.Hour)
			return
		case "long-tool":
			fmt.Println(`{"event":"step_update","step_update":{"conversation_id":"resume-123","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"sleep 1"}}}}`)
			time.Sleep(600 * time.Millisecond)
			fmt.Println(`{"event":"step_update","step_update":{"conversation_id":"resume-123","step_index":2,"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"sleep 1"},"output":"secret-output"}}}`)
		}
		if os.Getenv("CC_AGY_STREAM_FAILURE") == "empty-first" && turn == 1 {
			fmt.Println("{\"event\":\"result\",\"result\":{\"status\":\"SUCCESS\",\"response\":\"\"}}")
			continue
		}
		fmt.Println(`{"event":"step_update","step_update":{"step_type":"thinking","text_delta":"private thought"}}`)
		fmt.Printf(`{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"answer-%d"}}`+"\n", turn)
		fmt.Printf(`{"event":"result","result":{"conversation_id":"resume-123","status":"SUCCESS","response":"answer-%d"}}`+"\n", turn)
	}
}

func TestStreamSession_ProcessFailureUnblocksTurn(t *testing.T) {
	for _, failure := range []string{"exit", "malformed", "timeout"} {
		t.Run(failure, func(t *testing.T) {
			s, err := newStreamSession(context.Background(), os.Args[0],
				[]string{"-test.run=^TestStreamSession_ReusesProcessAndSeparatesThoughts$", "--"},
				t.TempDir(), "", "default", "resume-123",
				[]string{"CC_AGY_STREAM_TEST=1", "CC_AGY_STREAM_FAILURE=" + failure}, 200*time.Millisecond, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if err := s.Send("prompt-1", "msg", nil, nil); err != nil {
				t.Fatal(err)
			}
			deadline := time.After(3 * time.Second)
			for {
				select {
				case ev := <-s.Events():
					if ev.Type == core.EventError {
						if s.Alive() || ev.Error == nil {
							t.Fatal("failed process is still usable")
						}
						return
					}
				case <-deadline:
					t.Fatal("failed stream left the user waiting")
				}
			}
		})
	}
}

func TestStreamSession_ResultFallbackAndError(t *testing.T) {
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	s := &streamSession{antigravitySession: base, busy: true}
	var ev agyStreamEvent
	_ = json.Unmarshal([]byte(`{"event":"result","result":{"status":"SUCCESS","response":"whole answer","conversation_id":"saved"}}`), &ev)
	s.handleStreamEvent(ev)
	got := <-s.Events()
	if got.Type != core.EventResult || got.Content != "whole answer" || got.SessionID != "saved" || s.busy {
		t.Fatalf("unexpected result: %+v", got)
	}
	s.busy = true
	ev.Result.Status = "ERROR"
	ev.Result.Response = "provider unavailable"
	s.handleStreamEvent(ev)
	got = <-s.Events()
	if got.Type != core.EventError || got.Error == nil || s.busy {
		t.Fatalf("error was not surfaced: %+v", got)
	}
}

func TestStreamSession_StallWatchdog(t *testing.T) {
	start := func(t *testing.T, mode string) *streamSession {
		s, err := newStreamSession(context.Background(), os.Args[0],
			[]string{"-test.run=^TestStreamSession_ReusesProcessAndSeparatesThoughts$", "--"},
			t.TempDir(), "", "default", "resume-123",
			[]string{"CC_AGY_STREAM_TEST=1", "CC_AGY_STREAM_FAILURE=" + mode}, 0, 200*time.Millisecond)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = s.Close() })
		if err := s.Send("prompt-1", "msg", nil, nil); err != nil {
			t.Fatal(err)
		}
		return s
	}

	t.Run("silent model request is stopped", func(t *testing.T) {
		s := start(t, "stall")
		deadline := time.After(5 * time.Second)
		for {
			select {
			case ev := <-s.Events():
				if ev.Type == core.EventError {
					if ev.Error == nil || !strings.Contains(ev.Error.Error(), "no progress") || s.Alive() {
						t.Fatalf("stall not reported clearly: %+v alive=%t", ev, s.Alive())
					}
					return
				}
			case <-deadline:
				t.Fatal("stalled turn kept the user waiting")
			}
		}
	})

	t.Run("running tool is progress, not a stall", func(t *testing.T) {
		s := start(t, "long-tool")
		sawTool := false
		var answer strings.Builder
		deadline := time.After(5 * time.Second)
		for {
			select {
			case ev := <-s.Events():
				switch ev.Type {
				case core.EventError:
					t.Fatalf("long tool was treated as a stall: %v", ev.Error)
				case core.EventToolUse:
					if ev.ToolName != "run_command" || ev.ToolInput != "sleep 1" {
						t.Fatalf("unexpected tool event: %+v", ev)
					}
					sawTool = true
				case core.EventToolResult:
					t.Fatalf("successful tool should not add a result message: %+v", ev)
				case core.EventText:
					answer.WriteString(ev.Content)
				case core.EventResult:
					answer.WriteString(ev.Content)
					if !sawTool || answer.String() != "answer-1" {
						t.Fatalf("tool progress or answer missing: sawTool=%t answer=%q", sawTool, answer.String())
					}
					return
				}
			case <-deadline:
				t.Fatal("tool turn did not finish")
			}
		}
	})
}

func TestStreamSession_StallWaitsForPendingPermission(t *testing.T) {
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "default", "", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if base.permissionBridge == nil {
		t.Fatal("default mode must use the permission bridge")
	}
	stopped := make(chan struct{}, 1)
	s := &streamSession{antigravitySession: base, busy: true, stallTimeout: 50 * time.Millisecond,
		cancelProcess: func() { stopped <- struct{}{} }}
	base.permissionBridge.pendingMu.Lock()
	base.permissionBridge.pending["agy-perm-test"] = make(chan core.PermissionResult, 1)
	base.permissionBridge.pendingMu.Unlock()
	s.mu.Lock()
	s.touchLocked()
	s.mu.Unlock()
	select {
	case <-stopped:
		t.Fatal("turn stopped while waiting for a human decision")
	case <-time.After(250 * time.Millisecond):
	}
	base.permissionBridge.pendingMu.Lock()
	delete(base.permissionBridge.pending, "agy-perm-test")
	base.permissionBridge.pendingMu.Unlock()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("stall after the decision was not detected")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.stalled {
		t.Fatal("stall flag not set")
	}
}
