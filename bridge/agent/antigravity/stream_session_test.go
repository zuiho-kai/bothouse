package antigravity

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
		if json.Unmarshal(scanner.Bytes(), &input) != nil || input.Event != "user" || !strings.Contains(input.Message.Content, fmt.Sprintf("prompt-%d", turn)) || strings.Contains(input.Message.Content, "model list --json") { // #1903: the engine sends the preamble once, not the session
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
		sawResult := false
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
					if !sawTool || ev.ToolName != "run_command" || ev.ToolSuccess == nil || !*ev.ToolSuccess || ev.ToolResult != "" || ev.Content != "" {
						t.Fatalf("finished tool must report success without output: %+v", ev)
					}
					sawResult = true
				case core.EventText:
					answer.WriteString(ev.Content)
				case core.EventResult:
					answer.WriteString(ev.Content)
					if !sawTool || !sawResult || answer.String() != "answer-1" {
						t.Fatalf("tool progress or answer missing: sawTool=%t sawResult=%t answer=%q", sawTool, sawResult, answer.String())
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

// #2168: streamSession keeps workspace attachments in .cc-connect/attachments across turns and
// only deletes fallback files written to os.TempDir().
func TestStreamSession_RetainsWorkspaceAttachmentsAfterTurn(t *testing.T) {
	t.Run("workspace attachments survive turn", func(t *testing.T) {
		dir := t.TempDir()
		s, err := newStreamSession(context.Background(), os.Args[0],
			[]string{"-test.run=^TestStreamSession_ReusesProcessAndSeparatesThoughts$", "--"},
			dir, "", "default", "resume-123",
			[]string{"CC_AGY_STREAM_TEST=1"}, 5*time.Second, 0)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()

		err = s.Send("prompt-1", "msg",
			[]core.ImageAttachment{{MimeType: "image/png", Data: []byte("img-bytes")}},
			[]core.FileAttachment{{FileName: "stream-keep.txt", Data: []byte("doc-bytes")}},
		)
		if err != nil {
			t.Fatal(err)
		}
		deadline := time.After(3 * time.Second)
		for {
			select {
			case ev := <-s.Events():
				if ev.Type == core.EventError {
					t.Fatalf("unexpected error: %v", ev.Error)
				}
				if ev.Type == core.EventResult {
					attachDir := filepath.Join(dir, ".cc-connect", "attachments")
					if _, err := os.Stat(filepath.Join(attachDir, "stream-keep.txt")); err != nil {
						t.Fatalf("file attachment deleted after stream turn: %v", err)
					}
					entries, err := os.ReadDir(attachDir)
					if err != nil {
						t.Fatalf("read attachDir: %v", err)
					}
					hasImg := false
					for _, e := range entries {
						if strings.HasPrefix(e.Name(), "img_") && strings.HasSuffix(e.Name(), ".png") {
							hasImg = true
							break
						}
					}
					if !hasImg {
						t.Fatalf("image attachment deleted after stream turn; entries=%v", entries)
					}
					return
				}
			case <-deadline:
				t.Fatal("stream turn did not finish")
			}
		}
	})

	t.Run("tempdir fallback still cleans up", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, ".cc-connect"), []byte("blocker"), 0o600); err != nil {
			t.Fatal(err)
		}
		// Keep TMPDIR unchanged so the sandbox child check in os.Args[0] passes; use a unique
		// filename in os.TempDir() and ensure cleanup even if the assertion fails.
		fname := fmt.Sprintf("stream-fallback-%d.txt", time.Now().UnixNano())
		fallbackPath := filepath.Join(os.TempDir(), fname)
		t.Cleanup(func() { _ = os.Remove(fallbackPath) })

		s, err := newStreamSession(context.Background(), os.Args[0],
			[]string{"-test.run=^TestStreamSession_ReusesProcessAndSeparatesThoughts$", "--"},
			dir, "", "default", "resume-123",
			[]string{"CC_AGY_STREAM_TEST=1"}, 5*time.Second, 0)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()

		if err := s.Send("prompt-1", "msg", nil, []core.FileAttachment{{FileName: fname, Data: []byte("tmp")}}); err != nil {
			t.Fatal(err)
		}
		deadline := time.After(3 * time.Second)
		for {
			select {
			case ev := <-s.Events():
				if ev.Type == core.EventError {
					t.Fatalf("unexpected error: %v", ev.Error)
				}
				if ev.Type == core.EventResult {
					if _, err := os.Stat(fallbackPath); !os.IsNotExist(err) {
						t.Fatalf("fallback temp attachment should be removed after stream turn, got err=%v", err)
					}
					return
				}
			case <-deadline:
				t.Fatal("stream turn did not finish")
			}
		}
	})
}
