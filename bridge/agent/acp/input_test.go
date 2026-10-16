package acp

import (
	"bufio"
	"encoding/json"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

type inputRPCRequest struct {
	ID     json.RawMessage
	Method string
	Params struct{ SessionID string }
}

func inputUpdate(id, text string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
		"sessionId": id, "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": text}},
	}}
}

func TestStrictLoadNeverCreatesNewSession(t *testing.T) {
	for _, tc := range []struct {
		name     string
		supports bool
		result   any
		rpcError bool
		ok       bool
	}{
		{"standard empty object", true, map[string]any{}, false, true},
		{"vendor matching id", true, map[string]any{"sessionId": "test-session-id"}, false, true},
		{"wrong id", true, map[string]any{"sessionId": "different"}, false, false},
		{"null result", true, nil, false, false},
		{"failed load", true, nil, true, false},
		{"unsupported", false, nil, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, w, r := newTestSession(t, nil)
			s.strictResume, s.inputGuard = true, true
			done := make(chan struct{})
			var methods []string
			go func() {
				defer close(done)
				scan := bufio.NewScanner(r)
				enc := json.NewEncoder(w)
				for scan.Scan() {
					var req inputRPCRequest
					if json.Unmarshal(scan.Bytes(), &req) != nil {
						return
					}
					methods = append(methods, req.Method)
					var result any
					switch req.Method {
					case "initialize":
						result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"loadSession": tc.supports}}
					case "session/load":
						// More than the event buffer: replay must be discarded, not drained later.
						for i := 0; i < 160; i++ {
							_ = enc.Encode(inputUpdate(req.Params.SessionID, "old history"))
						}
						if tc.rpcError {
							_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32000, "message": "load failed"}})
							continue
						}
						result = tc.result
					case "session/new":
						result = map[string]any{"sessionId": "unwanted-new"}
					default:
						result = map[string]any{}
					}
					_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
				}
			}()
			err := s.handshake("test-session-id", "")
			_ = r.Close()
			<-done
			if (err == nil) != tc.ok {
				t.Fatalf("error=%v want success=%v", err, tc.ok)
			}
			for _, method := range methods {
				if method == "session/new" {
					t.Fatal("strict load created a replacement session")
				}
			}
			if len(s.events) != 0 {
				t.Fatal("history replay escaped into new answer")
			}
			if s.CurrentSessionID() != "test-session-id" {
				t.Fatal("changed original session binding")
			}
		})
	}
}

func TestStrictPromptCompletionAndSessionIsolation(t *testing.T) {
	for _, tc := range []struct {
		name, id, stop           string
		disconnect, rpcError, ok bool
	}{
		{name: "complete", id: "test-session-id", stop: "end_turn", ok: true},
		{name: "wrong session", id: "other", stop: "end_turn"},
		{name: "missing session", id: "", stop: "end_turn"},
		{name: "cancelled", id: "test-session-id", stop: "cancelled"},
		{name: "truncated", id: "test-session-id", stop: "max_tokens"},
		{name: "request limit", id: "test-session-id", stop: "max_turn_requests"},
		{name: "refused", id: "test-session-id", stop: "refusal"},
		{name: "missing reason", id: "test-session-id"},
		{name: "disconnected", id: "test-session-id", disconnect: true},
		{name: "rpc error", id: "test-session-id", rpcError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, w, r := newTestSession(t, nil)
			if err := s.PrepareResumed("test-session-id"); err != nil {
				t.Fatal(err)
			}
			// A notification arriving between prepare and send is also not this turn.
			raw, _ := json.Marshal(inputUpdate("test-session-id", "old")["params"])
			s.onNotification("session/update", raw)
			done := make(chan struct{})
			go func() {
				defer close(done)
				dec, enc := json.NewDecoder(r), json.NewEncoder(w)
				var req inputRPCRequest
				if dec.Decode(&req) != nil {
					return
				}
				if req.Params.SessionID != "test-session-id" {
					return
				}
				_ = enc.Encode(inputUpdate(tc.id, "current answer"))
				if tc.disconnect {
					_ = w.Close()
					return
				}
				response := map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"stopReason": tc.stop}}
				if tc.rpcError {
					delete(response, "result")
					response["error"] = map[string]any{"code": -32000, "message": "quota"}
				}
				_ = enc.Encode(response)
				_ = enc.Encode(inputUpdate(tc.id, "late output"))
				// Barrier guarantees the late update was dispatched before assertions.
				if dec.Decode(&req) == nil {
					_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{}})
				}
			}()
			err := s.SendResumed("hello", "message", nil, nil, "test-session-id")
			if !tc.disconnect {
				_, _ = s.tr.call(s.ctx, "test/barrier", nil)
			}
			<-done
			if (err == nil) != tc.ok {
				t.Fatalf("error=%v want success=%v", err, tc.ok)
			}
			var text string
			success := false
			for len(s.events) > 0 {
				ev := <-s.events
				if ev.Type == core.EventText {
					text += ev.Content
				}
				if ev.Type == core.EventResult {
					success = true
				}
			}
			if success != tc.ok {
				t.Fatalf("success=%v for %s", success, tc.name)
			}
			if strings.Contains(text, "old") || strings.Contains(text, "late") {
				t.Fatalf("unrelated output escaped: %q", text)
			}
			if tc.id != "test-session-id" && text != "" {
				t.Fatal("different session text was relabeled")
			}
		})
	}
}

func TestStrictLiveBindingCheckedBeforePrompt(t *testing.T) {
	s, _, _ := newTestSession(t, nil)
	if err := s.PrepareResumed("different"); err == nil {
		t.Fatal("accepted wrong live session")
	}
	if err := s.PrepareResumed("test-session-id"); err != nil {
		t.Fatal(err)
	}
	s.setACPSessionID("changed-between-prepare-and-send")
	if err := s.SendResumed("hello", "m", nil, nil, "test-session-id"); err == nil {
		t.Fatal("accepted changed binding")
	}
}

func TestStrictTransportClosesWindowBeforeNextNotification(t *testing.T) {
	var out strings.Builder
	active := true
	tr := newTransport(strings.NewReader(""), &out, func(_ string, _ json.RawMessage) {
		if active {
			t.Error("completion callback ran too late")
		}
	}, nil)
	ch := make(chan rpcOutcome, 1)
	tr.pending["1"] = pendingCall{ch: ch, complete: func() { active = false }}
	tr.dispatchLine([]byte(`{"jsonrpc":"2.0","id":1,"result":{}}`))
	tr.dispatchLine([]byte(`{"jsonrpc":"2.0","method":"session/update","params":{}}`))
	select {
	case <-ch:
	default:
		t.Fatal("caller not notified")
	}
}

func TestStrictCloseDuringPromptDoesNotRaceEventChannel(t *testing.T) {
	s, _, r := newTestSession(t, nil)
	result := make(chan any, 1)
	go func() {
		defer func() {
			if p := recover(); p != nil {
				result <- p
			}
		}()
		result <- s.SendResumed("hello", "m", nil, nil, "test-session-id")
	}()
	var request inputRPCRequest
	if err := json.NewDecoder(r).Decode(&request); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	value := <-result
	if err, ok := value.(error); !ok || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("closing an active prompt must report cancellation, got %v", value)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if err := s.Send("after close", "m", nil, nil); err == nil {
		t.Fatal("closed session accepted another turn")
	}
}
