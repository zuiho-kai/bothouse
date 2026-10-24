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

// TestHelperFakeAppServer is not a real test: the fake `codex` script re-runs
// the test binary with FAKE_APP_SERVER set, and it then speaks JSON-RPC on stdio.
func TestHelperFakeAppServer(t *testing.T) {
	scenario := os.Getenv("FAKE_APP_SERVER")
	if scenario == "" {
		return
	}
	log, _ := os.OpenFile(os.Getenv("FAKE_APP_SERVER_LOG"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	out := bufio.NewWriter(os.Stdout)
	send := func(v any) {
		b, _ := json.Marshal(v)
		out.Write(append(b, '\n'))
		out.Flush()
	}
	notify := func(method string, params any) { send(map[string]any{"method": method, "params": params}) }
	completed := func(thread, turn, status string) {
		p := map[string]any{"threadId": thread, "turn": map[string]any{"id": turn, "status": status}}
		if status == "failed" {
			p["turn"].(map[string]any)["error"] = map[string]any{"message": "boom"}
		}
		notify("turn/completed", p)
	}
	thread := ""
	turns := 0
	steers := 0
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for in.Scan() {
		var req struct {
			ID     any            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.Unmarshal(in.Bytes(), &req) != nil || req.ID == nil {
			continue
		}
		if log != nil {
			fmt.Fprintf(log, "%s\n", req.Method)
		}
		reply := func(result any) { send(map[string]any{"id": req.ID, "result": result}) }
		switch req.Method {
		case "thread/start":
			thread = "voice-fresh-thread"
			reply(map[string]any{"thread": map[string]any{"id": thread}, "model": "m"})
		case "thread/resume":
			if req.Params["excludeTurns"] != true {
				send(map[string]any{"id": req.ID, "error": map[string]any{"code": -32602, "message": "resume must exclude turns"}})
				continue
			}
			thread, _ = req.Params["threadId"].(string)
			id := thread
			if scenario == "resume-mismatch" {
				id = "different-thread"
			}
			reply(map[string]any{"thread": map[string]any{"id": id}, "model": "m"})
		case "turn/start":
			turns++
			turn := fmt.Sprintf("turn-%d", turns)
			if scenario == "early" {
				// Terminal notifications before the turn/start response.
				notify("turn/started", map[string]any{"threadId": thread, "turn": map[string]any{"id": turn}})
				notify("item/completed", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]any{"type": "agentMessage", "text": "answer"}})
				completed(thread, turn, "completed")
				reply(map[string]any{"turn": map[string]any{"id": turn}})
				continue
			}
			reply(map[string]any{"turn": map[string]any{"id": turn}})
			notify("turn/started", map[string]any{"threadId": thread, "turn": map[string]any{"id": turn}})
			if scenario == "steer-engine" {
				notify("item/completed", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]any{"type": "agentMessage", "phase": "commentary", "text": "Starting the original task."}})
				notify("item/started", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]any{"type": "commandExecution", "command": "long-running-work"}})
				continue
			}
			if scenario == "interrupt" && turns == 1 {
				continue // stays running until interrupted
			}
			switch scenario {
			case "hang", "steer", "steer-child", "steer-public":
				continue // stays running until steered
			case "idle-only":
				notify("thread/status/changed", map[string]any{"threadId": thread, "status": map[string]any{"type": "idle"}})
				continue
			}
			notify("item/completed", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]any{"type": "agentMessage", "text": "answer"}})
			switch scenario {
			case "other-turn":
				completed(thread, "turn-other", "completed")
			case "other-thread":
				completed("other-thread", turn, "completed")
			case "failed":
				completed(thread, turn, "failed")
			case "interrupted":
				completed(thread, turn, "interrupted")
			default:
				completed(thread, turn, "completed")
			}
			notify("thread/status/changed", map[string]any{"threadId": thread, "status": map[string]any{"type": "idle"}})
		case "turn/steer":
			reply(map[string]any{})
			if scenario == "steer-child" {
				// A child is created while the parent handles the inserted input.
				notify("thread/status/changed", map[string]any{"threadId": "child", "status": map[string]any{"type": "idle"}})
				notify("turn/started", map[string]any{"threadId": "child", "turn": map[string]any{"id": "child-turn"}})
				notify("item/completed", map[string]any{"threadId": "child", "turnId": "child-turn", "item": map[string]any{"type": "agentMessage", "text": "child-only result"}})
				completed("child", "child-turn", "completed")
			}

			turn, _ := req.Params["expectedTurnId"].(string)
			steers++
			if (scenario == "steer-public" || scenario == "steer-engine") && steers == 1 {
				notify("item/completed", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]any{"type": "agentMessage", "phase": "commentary", "text": "I received your inserted message; continuing the original task."}})
				continue // No next tool or turn completion to flush a buffered answer.
			}
			notify("item/completed", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]any{"type": "agentMessage", "text": "steered"}})
			completed(thread, turn, "completed")
		case "turn/interrupt":
			reply(map[string]any{})
			turn, _ := req.Params["turnId"].(string)
			completed(thread, turn, "interrupted")
			notify("thread/status/changed", map[string]any{"threadId": thread, "status": map[string]any{"type": "idle"}})
		default:
			reply(map[string]any{})
		}
	}
	os.Exit(0)
}

func fakeAppServerAgent(t *testing.T, scenario string) (*Agent, string) {
	t.Helper()
	home := inputCodexHome(t)
	bin := t.TempDir()
	script := fmt.Sprintf("#!/bin/sh\nexec %q -test.run=^TestHelperFakeAppServer$\n", os.Args[0])
	if err := os.WriteFile(filepath.Join(bin, "codex"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FAKE_APP_SERVER", scenario)
	log := filepath.Join(home, "rpc.log")
	t.Setenv("FAKE_APP_SERVER_LOG", log)
	return &Agent{backend: "app_server", codexHome: home, workDir: home, mode: "yolo", activeIdx: -1}, log
}

func TestLocalInputAppServerStrictResume(t *testing.T) {
	for _, scenario := range []string{"ok", "early"} {
		t.Run(scenario, func(t *testing.T) {
			a, log := fakeAppServerAgent(t, scenario)
			if !a.SupportsStrictResume() {
				t.Fatal("app_server should support strict resume")
			}
			as, err := a.StartSessionStrict(context.Background(), inputThreadID)
			if err != nil {
				t.Fatal(err)
			}
			defer as.Close()
			if as.CurrentSessionID() != inputThreadID {
				t.Fatalf("thread = %q", as.CurrentSessionID())
			}
			for i := 0; i < 2; i++ {
				if err := as.(core.StrictResumeSession).SendResumed("hello", "", nil, nil, inputThreadID); err != nil {
					t.Fatal(err)
				}
				ev, text := inputReadTerminal(t, as)
				if ev.Type != core.EventResult || text != "answer" || ev.SessionID != inputThreadID {
					t.Fatalf("event=%+v text=%q", ev, text)
				}
			}
			data, _ := os.ReadFile(log)
			if strings.Count(string(data), "thread/resume\n") != 1 || strings.Count(string(data), "turn/start\n") != 2 || strings.Contains(string(data), "thread/start\n") {
				t.Fatalf("rpc log: %s", data)
			}
		})
	}
}

func TestLocalInputAppServerResumeMismatch(t *testing.T) {
	a, log := fakeAppServerAgent(t, "resume-mismatch")
	if _, err := a.StartSessionStrict(context.Background(), inputThreadID); err == nil {
		t.Fatal("accepted a different resumed thread")
	}
	if data, _ := os.ReadFile(log); strings.Contains(string(data), "turn/start") {
		t.Fatalf("sent a turn after mismatch: %s", data)
	}
	if _, err := a.StartSessionStrict(context.Background(), "missing"); err == nil {
		t.Fatal("accepted a thread without rollout metadata")
	}
}

func TestLocalInputAppServerFailClosed(t *testing.T) {
	for _, scenario := range []string{"other-turn", "other-thread", "failed", "interrupted"} {
		t.Run(scenario, func(t *testing.T) {
			a, _ := fakeAppServerAgent(t, scenario)
			as, err := a.StartSessionStrict(context.Background(), inputThreadID)
			if err != nil {
				t.Fatal(err)
			}
			defer as.Close()
			if err := as.(core.StrictResumeSession).SendResumed("hello", "", nil, nil, inputThreadID); err != nil {
				t.Fatal(err)
			}
			ev, _ := inputReadTerminal(t, as)
			if ev.Type != core.EventError || ev.Error == nil {
				t.Fatalf("failure published success: %+v", ev)
			}
			// Trailing thread idle must not turn into a late success.
			select {
			case ev := <-as.Events():
				if ev.Type == core.EventResult {
					t.Fatalf("late success: %+v", ev)
				}
			case <-time.After(100 * time.Millisecond):
			}
		})
	}
}

func TestLocalInputAppServerIdleIsNotSuccess(t *testing.T) {
	a, _ := fakeAppServerAgent(t, "idle-only")
	as, err := a.StartSessionStrict(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	if err := as.(core.StrictResumeSession).SendResumed("hello", "", nil, nil, inputThreadID); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-as.Events():
		if ev.Type == core.EventResult {
			t.Fatalf("thread idle published success: %+v", ev)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func TestLocalInputAppServerBindingChanged(t *testing.T) {
	a, _ := fakeAppServerAgent(t, "ok")
	as, err := a.StartSessionStrict(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	if err := as.(core.StrictResumeSession).SendResumed("hello", "", nil, nil, "another-thread"); err == nil {
		t.Fatal("sent with a changed binding")
	}
}

func TestLocalInputAppServerBusyTurnRefused(t *testing.T) {
	a, log := fakeAppServerAgent(t, "hang")
	as, err := a.StartSessionStrict(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	if err := as.Send("long task", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	old := codexInputQuiesceTimeout
	codexInputQuiesceTimeout = 50 * time.Millisecond
	defer func() { codexInputQuiesceTimeout = old }()
	if err := as.(core.StrictResumeSession).SendResumed("voice", "", nil, nil, inputThreadID); err == nil {
		t.Fatal("strict input joined a running turn")
	}
	if as.Alive() {
		t.Fatal("orphaned turn was not retired")
	}
	if data, _ := os.ReadFile(log); strings.Contains(string(data), "turn/steer") || strings.Count(string(data), "turn/start\n") != 1 {
		t.Fatalf("rpc log: %s", data)
	}
}

func TestAppServerSendStillSteersMidTurn(t *testing.T) {
	a, log := fakeAppServerAgent(t, "steer")
	as, err := a.StartSession(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	if err := as.Send("first", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := as.Send("more", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	ev, text := inputReadTerminal(t, as)
	if ev.Type != core.EventResult || text != "steered" {
		t.Fatalf("event=%+v text=%q", ev, text)
	}
	if data, _ := os.ReadFile(log); strings.Count(string(data), "turn/steer\n") != 1 || strings.Count(string(data), "turn/start\n") != 1 {
		t.Fatalf("rpc log: %s", data)
	}
}

func TestAppServerSendSteersWithChildLifecycle(t *testing.T) {
	a, log := fakeAppServerAgent(t, "steer-child")
	as, err := a.StartSession(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	if err := as.Send("first", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := as.Send("more", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	ev, text := inputReadTerminal(t, as)
	if ev.Type != core.EventResult || text != "steered" {
		t.Fatalf("event=%+v text=%q", ev, text)
	}
	if data, _ := os.ReadFile(log); strings.Count(string(data), "turn/steer\n") != 1 || strings.Count(string(data), "turn/start\n") != 1 {
		t.Fatalf("rpc log: %s", data)
	}
}

func TestAppServerSendRefusedDuringStrictTurn(t *testing.T) {
	s := &appServerSession{events: make(chan core.Event, 4), strict: &appServerStrictTurn{thread: "t", turnID: "turn-1"}, currentTurn: "turn-1"}
	s.alive.Store(true)
	s.threadID.Store("t")
	if err := s.Send("discord", "", nil, nil); err == nil {
		t.Fatal("steered into a strict turn")
	}
	if !s.preambleSent && s.promptPreamble != "" {
		t.Fatal("preamble consumed")
	}
}

// maomao fork (user 10-23「取消后不报错」): CancelTurn interrupts only the running
// turn; the process and thread stay, and the next message is answered normally.
func TestAppServerCancelTurnKeepsThread(t *testing.T) {
	a, log := fakeAppServerAgent(t, "interrupt")
	as, err := a.StartSession(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	canceller, ok := any(as).(core.AgentSessionCanceller)
	if !ok {
		t.Fatal("app-server session does not implement core.AgentSessionCanceller")
	}
	if err := as.Send("first", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	thread := as.CurrentSessionID()
	if err := canceller.CancelTurn(); err != nil {
		t.Fatal(err)
	}
	ev, text := inputReadTerminal(t, as)
	if ev.Type != core.EventError || text != "" {
		t.Fatalf("cancelled turn: event=%+v text=%q", ev, text)
	}
	if !as.Alive() || as.CurrentSessionID() != thread {
		t.Fatalf("alive=%v thread=%q want %q", as.Alive(), as.CurrentSessionID(), thread)
	}
	if err := as.Send("暂停，你在干啥", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	ev, text = inputReadTerminal(t, as)
	if ev.Type != core.EventResult || text != "answer" {
		t.Fatalf("next turn: event=%+v text=%q", ev, text)
	}
	data, _ := os.ReadFile(log)
	if strings.Count(string(data), "turn/interrupt\n") != 1 || strings.Count(string(data), "turn/start\n") != 2 {
		t.Fatalf("rpc log: %s", data)
	}
}
