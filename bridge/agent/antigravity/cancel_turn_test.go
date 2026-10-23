package antigravity

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork (2026-10-23 20:06, user to 彩虹猫「暂停，你在干啥」→ "❌ 错误: session reset"): a gate
// abort / stop cancels only the running agy turn. The session stays alive with the same
// conversation, the cancelled turn ends with exactly one EventError (core logs it) and no
// "⚠️ signal: killed" text, and the next message resumes the conversation.
func TestCancelTurnStopsOnlyTheTurnAndKeepsConversation(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	dir := t.TempDir()
	cmdPath, argsPath := fakeAgyRuns(t, dir,
		agyInitA+"\n"+`echo '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"半截"}}'`+"\nexec sleep 30",
		agyInitA+"\n"+`echo '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"我刚才在跑长任务，已停"}}'`+"\n"+
			`echo '{"event":"result","result":{"conversation_id":"conv-a","status":"SUCCESS"}}'`,
	)
	s, err := newAntigravitySession(context.Background(), cmdPath, nil, dir, "", "yolo", "", nil, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()
	canceller, ok := any(s).(core.AgentSessionCanceller)
	if !ok {
		t.Fatal("antigravitySession does not implement core.AgentSessionCanceller: an abort kills the session (engine normalCleanup → \"session reset\")")
	}
	if err := s.Send("跑一个很长的任务", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	// wait for the partial reply, so the turn is mid-way when cancelled
	deadline := time.After(5 * time.Second)
	for got := ""; !strings.Contains(got, "半截"); {
		select {
		case ev := <-s.Events():
			got += ev.Content
		case <-deadline:
			t.Fatal("first turn never streamed")
		}
	}
	start := time.Now()
	if err := canceller.CancelTurn(); err != nil {
		t.Fatalf("CancelTurn: %v", err)
	}
	te := collectTurn(t, s)
	if len(te.errs) != 1 || te.results != 0 || strings.Contains(te.text, "⚠️") || strings.Contains(te.text, "killed") {
		t.Fatalf("cancelled turn events = %+v, want exactly one EventError and no warning text", te)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("cancel took %s", time.Since(start))
	}
	if !s.Alive() || s.CurrentSessionID() != "conv-a" {
		t.Fatalf("after cancel alive=%v id=%q, want alive with conv-a", s.Alive(), s.CurrentSessionID())
	}
	if err := s.Send("暂停，你在干啥", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	te = collectTurn(t, s)
	if len(te.errs) != 0 || te.results != 1 || !strings.Contains(te.text, "已停") {
		t.Fatalf("next turn = %+v, want the answer", te)
	}
	runs := agyRuns(t, argsPath)
	if len(runs) != 2 || !strings.Contains(runs[1], "--conversation\nconv-a\n") {
		t.Fatalf("next turn must resume conv-a; launches=%q", runs)
	}
	// nothing running: CancelTurn is a no-op and emits nothing
	if err := canceller.CancelTurn(); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-s.Events():
		t.Fatalf("idle CancelTurn emitted %+v", ev)
	case <-time.After(200 * time.Millisecond):
	}
}

// The stream transport cannot stop a single turn; it reports that, so core falls back to
// Close and resumes the conversation in a new process.
func TestStreamSessionCancelTurnFallsBack(t *testing.T) {
	s, ok := any(&streamSession{}).(core.AgentSessionCanceller)
	if !ok {
		return // no CancelTurn at all also means core falls back to Close
	}
	if err := s.CancelTurn(); err == nil {
		t.Fatal("stream CancelTurn should report it cannot cancel one turn")
	}
}
