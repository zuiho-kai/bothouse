package core

import (
	"strings"
	"testing"
)

func TestGroupContextPreservesControlInput(t *testing.T) {
	t.Run("command", func(t *testing.T) {
		p := &stubPlatformEngine{n: "test"}
		sess := newPromptCaptureSession()
		e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
		defer e.Stop()
		e.handleMessage(p, &Message{SessionKey: "test:control", Platform: "test", UserID: "u", UserName: "Alice", GroupChat: true, Content: "/help", AmbientChat: "[recent]\nBob: hello", ReplyCtx: "ctx"})
		if len(p.getSent()) == 0 {
			t.Fatal("/help did not execute with group context")
		}
		if len(sess.sent()) != 0 {
			t.Fatal("command reached the model")
		}
	})
	t.Run("permission", func(t *testing.T) {
		e := newTestEngine()
		p := &stubPlatformEngine{n: "test"}
		rec := &recordingAgentSession{}
		e.interactiveStates["test:control"] = &interactiveState{agentSession: rec, platform: p, replyCtx: "ctx", pending: &pendingPermission{RequestID: "request", ToolName: "read", Resolved: make(chan struct{})}}
		e.handleMessage(p, &Message{SessionKey: "test:control", Platform: "test", UserID: "u", UserName: "Alice", GroupChat: true, Content: "allow", AmbientChat: "[recent]\nBob: hello", ReplyCtx: "ctx"})
		if rec.calls != 1 || rec.lastResult.Behavior != "allow" {
			t.Fatalf("permission not resolved: calls=%d result=%+v", rec.calls, rec.lastResult)
		}
	})
	t.Run("gate", func(t *testing.T) {
		var got string
		srv := ambientGate(t, func(req gateRequest) string { got = req.Content; return "silent" })
		e, _, p := ambientEngine(t, srv)
		msg := &Message{SessionKey: "test:control", Platform: "test", UserID: "u", UserName: "Alice", GroupChat: true, Content: "停", AmbientChat: "[recent]\nBob: Assistant hello", ReplyCtx: "ctx"}
		e.gate.released[msg] = true
		e.handleMessage(p, msg)
		if got != "停" || !isLocalStopWord(userTextOf(msg)) {
			t.Fatalf("gate received decorated input: %q", got)
		}
	})
}

func TestQueuedGroupContextAppearsOnce(t *testing.T) {
	e := newTestEngine()
	p := &stubPlatformEngine{n: "test"}
	state := &interactiveState{agentSession: newControllableSession("busy"), platform: p, replyCtx: "ctx"}
	e.interactiveStates["test:batch"] = state
	for _, text := range []string{"first", "second"} {
		msg := &Message{SessionKey: "test:batch", UserID: "u", AmbientChat: "[recent]\nBob: hello", Content: "[recent]\nBob: hello\nAlice: " + text}
		if !e.queueMessageForBusySession(p, msg, "test:batch") {
			t.Fatal("not queued")
		}
	}
	merged := takeQueuedBatchLocked(state)
	if strings.Count(merged.content, "[recent]") != 1 || !strings.Contains(merged.content, "Alice: first") || !strings.Contains(merged.content, "Alice: second") {
		t.Fatalf("bad batch: %q", merged.content)
	}
}
