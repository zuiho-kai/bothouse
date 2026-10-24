package claudecode

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

type bufWriteCloser struct{ bytes.Buffer }

func (*bufWriteCloser) Close() error { return nil }

// maomao fork (user 10-23「取消后不报错」): CancelTurn sends an interrupt
// control_request and keeps the process; the interrupted turn ends with one
// EventError, and the next turn's result is delivered normally.
func TestClaudeCancelTurnInterrupt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stdin := &bufWriteCloser{}
	cs := &claudeSession{events: make(chan core.Event, 8), ctx: ctx, stdin: stdin}
	cs.alive.Store(true)
	canceller, ok := any(cs).(core.AgentSessionCanceller)
	if !ok {
		t.Fatal("claudeSession does not implement core.AgentSessionCanceller")
	}
	if err := canceller.CancelTurn(); err != nil {
		t.Fatal(err)
	}
	var req map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(stdin.Bytes()), &req); err != nil {
		t.Fatalf("stdin %q: %v", stdin.String(), err)
	}
	inner, _ := req["request"].(map[string]any)
	if req["type"] != "control_request" || req["request_id"] == "" || inner["subtype"] != "interrupt" {
		t.Fatalf("stdin request: %v", req)
	}
	if !cs.Alive() {
		t.Fatal("session closed by CancelTurn")
	}

	cs.handleResult(map[string]any{"type": "result", "subtype": "error_during_execution", "is_error": true, "session_id": "s1"})
	if ev := <-cs.events; ev.Type != core.EventError {
		t.Fatalf("interrupted turn: %+v", ev)
	}
	if err := cs.Send("暂停，你在干啥", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	cs.handleResult(map[string]any{"type": "result", "subtype": "success", "result": "answer", "session_id": "s1"})
	if ev := <-cs.events; ev.Type != core.EventResult || !ev.Done || ev.Content != "answer" || ev.SessionID != "s1" {
		t.Fatalf("next turn: %+v", ev)
	}
}

// An interrupt that lands after the turn already finished cleanly leaves the
// success result alone.
func TestClaudeCancelTurnSuccessResultKept(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cs := &claudeSession{events: make(chan core.Event, 8), ctx: ctx, stdin: &bufWriteCloser{}}
	cs.alive.Store(true)
	canceller, ok := any(cs).(core.AgentSessionCanceller)
	if !ok {
		t.Fatal("claudeSession does not implement core.AgentSessionCanceller")
	}
	if err := canceller.CancelTurn(); err != nil {
		t.Fatal(err)
	}
	cs.handleResult(map[string]any{"type": "result", "subtype": "success", "result": "done"})
	if ev := <-cs.events; ev.Type != core.EventResult || ev.Content != "done" {
		t.Fatalf("event: %+v", ev)
	}
	cs.handleResult(map[string]any{"type": "result", "subtype": "error_during_execution", "result": "x"})
	if ev := <-cs.events; ev.Type != core.EventResult {
		t.Fatalf("flag not cleared: %+v", ev)
	}
}
