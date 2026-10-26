package core

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// handoffScriptSession drives one interactive turn: Send can fail immediately
// (first-send failure) or emit a terminal event for the event loop.
type handoffScriptSession struct {
	*controllableAgentSession
	sendErr error
	onSend  func()
	sent    []string
}

func newHandoffScriptSession(id string) *handoffScriptSession {
	return &handoffScriptSession{controllableAgentSession: newControllableSession(id)}
}

func (s *handoffScriptSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.sent = append(s.sent, prompt)
	if s.onSend != nil {
		s.onSend()
	}
	return s.sendErr
}

// runHandoffTurn assembles the turn blocks and runs the real interactive turn
// loop (send + event consumption), so acknowledgement timing is exercised at
// the same point production confirms it.
func runHandoffTurn(t *testing.T, e *Engine, session *Session, key, content string, as AgentSession) string {
	t.Helper()
	built := e.withTurnBlocks(session, key, "", content, true)
	state := &interactiveState{agentSession: as, platform: &stubPlatformEngine{n: "discord"}, replyCtx: "rctx"}
	e.interactiveMu.Lock()
	e.interactiveStates[key] = state
	e.interactiveMu.Unlock()
	e.runTurnWithCapacityRetry(state, session, e.sessions, key, "m1", time.Now(), nil, "rctx", nil, nil,
		func(as AgentSession) error { return as.Send(built, "m1", nil, nil) },
		func(time.Duration) {})
	return built
}

// TestLeadHandoffTurnFailureStaysPendingAndRetries is the regression test for
// the review finding: assembling a prompt must not confirm the handoff. A
// failed send, a failed turn and the following successful retry must keep the
// record pending until the model actually returns a terminal result; every
// retry must carry the complete record again.
func TestLeadHandoffTurnFailureStaysPendingAndRetries(t *testing.T) {
	dir := t.TempDir()
	writeHandoffLead(t, dir, "lead-a", "Lead A", "")
	a := handoffTestEngine(t, dir, "lead-a", "Lead A", &namedTestAgent{name: "claudecode"})
	if h := a.observeLeadSelection(); h != nil {
		t.Fatalf("initial selection must not create a handoff: %+v", h)
	}
	_, taskID := handoffTestTask(t, dir)
	writeHandoffLead(t, dir, "lead-d", "Lead D", time.Now().UTC().Format(time.RFC3339))
	d := handoffTestEngine(t, dir, "lead-d", "Lead D", &namedTestAgent{name: "codex"})
	session := d.sessions.GetOrCreateActive("discord:room")

	// First send fails (adapter_eof): the record must not become active.
	first := newHandoffScriptSession("s1")
	first.sendErr = fmt.Errorf("adapter_eof")
	content := runHandoffTurn(t, d, session, "discord:room", "用户消息", first)
	if !strings.Contains(content, "主角色交接") || !strings.Contains(content, taskID) {
		t.Fatalf("first turn did not carry the full record:\n%s", content)
	}
	st, err := ReadLeadHandoffState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Pending == nil || st.Pending.Status != LeadHandoffPending || !st.Pending.AckedAt.IsZero() {
		t.Fatalf("a failed send confirmed the handoff: %+v", st.Pending)
	}
	if id, _ := session.leadHandoffSent(); id != "" {
		t.Fatalf("session marked the handoff as received after a failed send: %q", id)
	}

	// The next turn fails after the model request (503): still pending, and
	// it must get the complete record again, not a post-switch delta.
	failedTurn := newHandoffScriptSession("s2")
	failedTurn.onSend = func() {
		failedTurn.events <- Event{Type: EventError, Error: fmt.Errorf("503 service unavailable")}
	}
	content = runHandoffTurn(t, d, session, "discord:room", "重试", failedTurn)
	if !strings.Contains(content, "主角色交接") || !strings.Contains(content, taskID) {
		t.Fatalf("retry after a failed turn did not carry the full record:\n%s", content)
	}
	st, err = ReadLeadHandoffState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Pending == nil || st.Pending.Status != LeadHandoffPending || !st.Pending.AckedAt.IsZero() {
		t.Fatalf("a failed turn confirmed the handoff: %+v", st.Pending)
	}

	// The next successful turn confirms it.
	success := newHandoffScriptSession("s3")
	success.onSend = func() {
		success.events <- Event{Type: EventResult, Content: "已接手", Done: true}
	}
	content = runHandoffTurn(t, d, session, "discord:room", "再次", success)
	if !strings.Contains(content, "主角色交接") || !strings.Contains(content, taskID) {
		t.Fatalf("successful retry did not carry the full record:\n%s", content)
	}
	st, err = ReadLeadHandoffState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Pending == nil || st.Pending.Status != LeadHandoffActive || st.Pending.AckedAt.IsZero() {
		t.Fatalf("successful turn did not confirm the handoff: %+v", st.Pending)
	}
	if id, _ := session.leadHandoffSent(); st.Pending == nil || id != st.Pending.ID {
		t.Fatalf("session did not record the confirmed handoff: %q, state %+v", id, st.Pending)
	}

	// Once confirmed, the same agent context gets no second full block.
	if got := d.withTurnBlocks(session, "discord:room", "", "下一轮", true); strings.Contains(got, "主角色交接") {
		t.Fatalf("confirmed handoff was injected again:\n%s", got)
	}
}
