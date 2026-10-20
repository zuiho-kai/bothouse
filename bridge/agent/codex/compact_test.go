package codex

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

// The test binary acts as the native stdio server. No real model, credentials or
// production thread is used; the client must send exactly initialize/resume/compact.
func TestCompactHelperProcess(t *testing.T) {
	mode := os.Getenv("CONEST_COMPACT_HELPER")
	if mode == "" {
		return
	}
	enc := json.NewEncoder(os.Stdout)
	emit := func(v any) { _ = enc.Encode(v) }
	notify := func(method string, params any) { emit(map[string]any{"method": method, "params": params}) }
	turn := func(status string) {
		notify("turn/"+status, map[string]any{"threadId": "thread-original", "turn": map[string]any{"id": "compact-turn", "status": "completed"}})
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var req struct {
			ID     int
			Method string
			Params map[string]any
		}
		if json.Unmarshal(scanner.Bytes(), &req) != nil {
			os.Exit(3)
		}
		reply := func(result any) { emit(map[string]any{"id": req.ID, "result": result}) }
		switch req.Method {
		case "initialize":
			reply(map[string]any{})
		case "initialized":
		case "thread/resume":
			if path := os.Getenv("CONEST_COMPACT_RECORD"); path != "" {
				b, _ := json.Marshal(req.Params)
				_ = os.WriteFile(path, b, 0o600)
			}
			if req.Params["threadId"] != "thread-original" || req.Params["model"] != "new-model" || req.Params["excludeTurns"] != true {
				os.Exit(4)
			}
			id := "thread-original"
			model := "new-model"
			if mode == "wrong-thread" {
				id = "replacement"
			}
			if mode == "wrong-model" {
				model = "old-model"
			}
			reply(map[string]any{"thread": map[string]any{"id": id}, "model": model})
		case "thread/compact/start":
			if req.Params["threadId"] != "thread-original" {
				os.Exit(5)
			}
			if mode == "rpc-error" {
				emit(map[string]any{"id": req.ID, "error": map[string]any{"code": -1, "message": "at capacity"}})
				continue
			}
			if mode != "early-events" {
				reply(map[string]any{})
			}
			if mode == "disconnect" {
				os.Exit(0)
			}
			if mode == "timeout" {
				time.Sleep(10 * time.Second)
				os.Exit(0)
			}
			turn("started")
			if mode == "error" {
				notify("error", map[string]any{"threadId": "thread-original", "turnId": "compact-turn", "error": map[string]any{"message": "at capacity"}, "willRetry": false})
				os.Exit(0)
			}
			if mode == "failed" || mode == "interrupted" {
				notify("turn/completed", map[string]any{"threadId": "thread-original", "turn": map[string]any{"id": "compact-turn", "status": mode}})
				os.Exit(0)
			}
			if mode != "missing-item" {
				notify("item/completed", map[string]any{"threadId": "thread-original", "turnId": "compact-turn", "item": map[string]any{"type": "contextCompaction"}})
			}
			// Idle alone must not complete the operation.
			notify("thread/status/changed", map[string]any{"threadId": "thread-original", "status": map[string]any{"type": "idle"}})
			turn("completed")
			if mode == "early-events" {
				reply(map[string]any{})
			}
		default:
			fmt.Fprintln(os.Stderr, "unexpected", req.Method)
			os.Exit(6)
		}
	}
	os.Exit(0)
}

func TestNativeCompactProtocol(t *testing.T) {
	for _, tc := range []struct{ mode, want string }{{"ok", ""}, {"early-events", ""}, {"wrong-thread", "different or missing thread"}, {"wrong-model", "model mismatch"}, {"rpc-error", "at capacity"}, {"error", "at capacity"}, {"disconnect", "before completion"}, {"failed", "failed"}, {"interrupted", "interrupted"}, {"missing-item", "without compaction evidence"}, {"timeout", "deadline exceeded"}} {
		t.Run(tc.mode, func(t *testing.T) {
			timeout := 3 * time.Second
			if tc.mode == "timeout" {
				timeout = 250 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			cs, err := newCodexSession(ctx, os.Args[0], []string{"-test.run=^TestCompactHelperProcess$", "--"}, t.TempDir(), "new-model", "high", "suggest", "thread-original", "", []string{"CONEST_COMPACT_HELPER=" + tc.mode}, "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			defer cs.Close()
			err = cs.compactNative(ctx)
			if tc.want == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("want %q, got %v", tc.want, err)
			}
			if cs.CurrentSessionID() != "thread-original" {
				t.Fatal("replaced original thread")
			}
		})
	}
}
func TestCompactProgressIgnoresOtherThreadsAndIdle(t *testing.T) {
	p := compactProgress{thread: "original"}
	for _, raw := range []string{
		`{"threadId":"other","turn":{"id":"x","status":"completed"}}`,
		`{"threadId":"original","turn":{"id":"x","status":"completed"}}`,
	} {
		if err := p.notification("turn/completed", json.RawMessage(raw)); err != nil {
			t.Fatal(err)
		}
	}
	if err := p.notification("thread/status/changed", json.RawMessage(`{"threadId":"original","status":{"type":"idle"}}`)); err != nil {
		t.Fatal(err)
	}
	if p.done {
		t.Fatal("idle or unrelated completion accepted")
	}
}

func TestAgentNativeCompactBothBackends(t *testing.T) {
	for _, backend := range []string{"exec", "app_server"} {
		t.Run(backend, func(t *testing.T) {
			a := &Agent{workDir: t.TempDir(), model: "new-model", reasoningEffort: "high", mode: "suggest", backend: backend, cmd: os.Args[0], cliExtraArgs: []string{"-test.run=^TestCompactHelperProcess$", "--"}, activeIdx: -1, configEnv: []string{"CONEST_COMPACT_HELPER=ok"}, codexHome: t.TempDir()}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := a.CompactSession(ctx, "thread-original"); err != nil {
				t.Fatal(err)
			}
			if a.backend != backend {
				t.Fatal("changed chat backend")
			}
			if err := a.CompactSession(ctx, ""); err == nil {
				t.Fatal("allowed new thread")
			}
		})
	}
}

// Compaction resumes the thread with the settings its chat sessions use: the
// per-session base instructions and, on the app_server backend (the only one
// that applies it to chats), the permission_profile sent as
// config.default_permissions with no explicit sandbox that would override it.
func TestAgentNativeCompactUsesSessionInstructionsAndPermissionProfile(t *testing.T) {
	for _, backend := range []string{"exec", "app_server"} {
		t.Run(backend, func(t *testing.T) {
			record := filepath.Join(t.TempDir(), "resume.json")
			a := &Agent{workDir: t.TempDir(), model: "new-model", reasoningEffort: "high", mode: "full-auto", backend: backend, cmd: os.Args[0], cliExtraArgs: []string{"-test.run=^TestCompactHelperProcess$", "--"}, activeIdx: -1, configEnv: []string{"CONEST_COMPACT_HELPER=ok", "CONEST_COMPACT_RECORD=" + record}, codexHome: t.TempDir(), permissionProfile: "chat-only"}
			// Another channel's session start left its settings on the shared agent.
			a.SetSessionModel("other-channel-model")
			a.SetSessionInstructions("/x/other.md", "other channel prompt")
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := a.CompactSessionWith(ctx, "thread-original", core.SessionSettings{Model: "new-model", InstructionsPath: "/x/chat.md", InstructionsText: "chat channel prompt"}); err != nil {
				t.Fatal(err)
			}
			a.mu.RLock()
			shared := a.sessionModel + "|" + a.sessionInstr
			a.mu.RUnlock()
			if shared != "other-channel-model|/x/other.md" {
				t.Errorf("compaction changed the shared agent settings to %q", shared)
			}
			b, err := os.ReadFile(record)
			if err != nil {
				t.Fatal(err)
			}
			var params map[string]any
			if err := json.Unmarshal(b, &params); err != nil {
				t.Fatal(err)
			}
			if params["baseInstructions"] != "chat channel prompt" {
				t.Errorf("baseInstructions = %v, want the session's instructions", params["baseInstructions"])
			}
			cfg, _ := params["config"].(map[string]any)
			if cfg["model_reasoning_effort"] != "high" {
				t.Errorf("config = %v, want the effort", params["config"])
			}
			_, hasSandbox := params["sandbox"]
			if backend == "app_server" {
				if cfg["default_permissions"] != "chat-only" || hasSandbox {
					t.Errorf("config = %v sandbox = %v, want default_permissions and no sandbox", params["config"], params["sandbox"])
				}
			} else if cfg["default_permissions"] != nil || params["sandbox"] != "workspace-write" {
				t.Errorf("exec backend: config = %v sandbox = %v, want the mode's sandbox as its chats use", params["config"], params["sandbox"])
			}
		})
	}
}
