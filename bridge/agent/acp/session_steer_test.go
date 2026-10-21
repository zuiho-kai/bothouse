package acp

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// 1x1 PNG.
var steerTestPNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

type steerRPC struct {
	ID     json.RawMessage
	Method string
	Params struct {
		SessionID string           `json:"sessionId"`
		Prompt    []map[string]any `json:"prompt"`
		Meta      map[string]any   `json:"_meta"`
	}
}

func chunk(id, msgID, text string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
		"sessionId": id, "update": map[string]any{"sessionUpdate": "agent_message_chunk", "messageId": msgID, "content": map[string]any{"type": "text", "text": text}},
	}}
}

func TestHandshakeReadsSteerAndImageCapabilities(t *testing.T) {
	for _, tc := range []struct {
		name         string
		caps         map[string]any
		steer, image bool
	}{
		{"dsh", map[string]any{"promptCapabilities": map[string]any{"image": true}, "_meta": map[string]any{"dsh/steer": true}}, true, true},
		{"plain acp", map[string]any{"promptCapabilities": map[string]any{"image": false}}, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := &Agent{}
			s, w, r := newTestSession(t, a)
			go func() {
				dec, enc := json.NewDecoder(r), json.NewEncoder(w)
				for {
					var req steerRPC
					if dec.Decode(&req) != nil {
						return
					}
					result := map[string]any{"sessionId": "new-id"}
					if req.Method == "initialize" {
						result = map[string]any{"protocolVersion": 1, "agentCapabilities": tc.caps}
					}
					_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
				}
			}()
			if err := s.handshake("", ""); err != nil {
				t.Fatal(err)
			}
			if s.steerSupported.Load() != tc.steer || a.SupportsMidTurnInput() != tc.steer || s.imagePrompts.Load() != tc.image {
				t.Fatalf("steer=%v agent=%v image=%v", s.steerSupported.Load(), a.SupportsMidTurnInput(), s.imagePrompts.Load())
			}
		})
	}
}

// A message steered into a running prompt returns at once, keeps that prompt's output, and the
// turn still ends with exactly one result carrying both answers.
func TestSendMidTurnSteersIntoRunningPrompt(t *testing.T) {
	s, w, r := newTestSession(t, nil)
	s.steerSupported.Store(true)
	s.imagePrompts.Store(true)
	sid := s.CurrentSessionID()

	firstSeen, steerSeen, finish := make(chan struct{}), make(chan steerRPC, 1), make(chan struct{})
	go func() {
		dec, enc := json.NewDecoder(r), json.NewEncoder(w)
		var first steerRPC
		if dec.Decode(&first) != nil {
			return
		}
		_ = enc.Encode(chunk(sid, "m1", "first answer. "))
		close(firstSeen)
		var steer steerRPC
		if dec.Decode(&steer) != nil {
			return
		}
		steerSeen <- steer
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": steer.ID, "result": map[string]any{"stopReason": "end_turn", "_meta": map[string]any{"dsh/steered": true}}})
		<-finish
		_ = enc.Encode(chunk(sid, "m2", "steered answer."))
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": first.ID, "result": map[string]any{"stopReason": "end_turn"}})
	}()

	sendErr := make(chan error, 1)
	go func() { sendErr <- s.Send("first", "m", nil, nil) }()
	<-firstSeen
	start := time.Now()
	if err := s.SendMidTurn("second", "m2", []core.ImageAttachment{{Data: steerTestPNG}}, nil); err != nil {
		t.Fatalf("SendMidTurn: %v", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("SendMidTurn blocked on the running prompt")
	}
	steer := <-steerSeen
	if steer.Params.Meta["dsh/steer"] != true {
		t.Fatalf("steer request not marked: %+v", steer.Params.Meta)
	}
	if text, _ := steer.Params.Prompt[0]["text"].(string); text != "second" {
		t.Fatalf("steer text = %q, want the message alone (the running prompt carried the model skill)", text)
	}
	if len(steer.Params.Prompt) != 2 || steer.Params.Prompt[1]["type"] != "image" || steer.Params.Prompt[1]["mimeType"] != "image/png" {
		t.Fatalf("steer prompt blocks = %v", steer.Params.Prompt)
	}
	close(finish)
	if err := <-sendErr; err != nil {
		t.Fatalf("first Send: %v", err)
	}
	var text string
	results := 0
	for len(s.events) > 0 {
		ev := <-s.events
		switch ev.Type {
		case core.EventText:
			text += ev.Content
		case core.EventResult:
			results++
		case core.EventError:
			t.Fatalf("unexpected error event: %v", ev.Error)
		}
	}
	if results != 1 || !strings.Contains(text, "first answer.") || !strings.Contains(text, "steered answer.") {
		t.Fatalf("results=%d text=%q", results, text)
	}
}

// Without a running prompt or peer support, SendMidTurn refuses without sending anything (a
// blocked call here would mean it started a turn), so the gate queues the message.
func TestSendMidTurnRefusesWithoutRunningPromptOrSupport(t *testing.T) {
	for _, tc := range []struct {
		name            string
		steer, inFlight bool
	}{
		{"idle", true, false},
		{"unsupported", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _ := newTestSession(t, nil)
			s.steerSupported.Store(tc.steer)
			s.promptInFlight.Store(tc.inFlight)
			done := make(chan error, 1)
			go func() { done <- s.SendMidTurn("hi", "m", nil, nil) }()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("SendMidTurn accepted input it cannot steer")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("SendMidTurn sent a request")
			}
		})
	}
}

// An agent rejecting the steer (its prompt settled meanwhile) surfaces as an error to queue on.
func TestSendMidTurnReportsRejectedSteer(t *testing.T) {
	s, w, r := newTestSession(t, nil)
	s.steerSupported.Store(true)
	s.promptInFlight.Store(true)
	go func() {
		dec, enc := json.NewDecoder(r), json.NewEncoder(w)
		var req steerRPC
		if dec.Decode(&req) != nil {
			return
		}
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32602, "message": "no prompt in flight to steer"}})
	}()
	if err := s.SendMidTurn("hi", "m", nil, nil); err == nil {
		t.Fatal("rejected steer reported as delivered")
	}
}

func TestPromptBlocksImages(t *testing.T) {
	s, _, _ := newTestSession(t, nil)
	heic := core.ImageAttachment{MimeType: "image/heic", Data: []byte("not a raster the agent takes")}
	png := core.ImageAttachment{Data: steerTestPNG} // no MimeType: sniffed

	s.imagePrompts.Store(true)
	blocks := s.promptBlocks("", "m", []core.ImageAttachment{png, heic}, nil, true)
	if len(blocks) != 2 {
		t.Fatalf("blocks = %v", blocks)
	}
	text := blocks[0].(map[string]any)["text"].(string)
	img := blocks[1].(map[string]any)
	if img["type"] != "image" || img["mimeType"] != "image/png" || img["data"] != base64.StdEncoding.EncodeToString(steerTestPNG) {
		t.Fatalf("image block = %v", img)
	}
	if !strings.Contains(text, "Image files saved locally") || strings.Count(text, ".cc-connect") != 1 {
		t.Fatalf("unsupported image must fall back to a saved path: %q", text)
	}

	s.imagePrompts.Store(false)
	blocks = s.promptBlocks("look", "m", []core.ImageAttachment{png}, nil, true)
	if len(blocks) != 1 || !strings.Contains(blocks[0].(map[string]any)["text"].(string), "Image files saved locally") {
		t.Fatalf("agent without image prompts gets paths only: %v", blocks)
	}
}

// DSH's tool_call_update carries no title: the result line is labelled with the tool_call's name,
// not its toolCallId.
func TestToolResultUsesToolCallName(t *testing.T) {
	s, _, _ := newTestSession(t, nil)
	s.toolNameByID = make(map[string]string)
	sid := s.CurrentSessionID()
	notify := func(update map[string]any) {
		raw, _ := json.Marshal(map[string]any{"sessionId": sid, "update": update})
		s.onNotification("session/update", raw)
	}
	notify(map[string]any{"sessionUpdate": "tool_call", "toolCallId": "call_1", "title": "bash", "kind": "execute", "status": "pending", "rawInput": map[string]any{"command": "ls"}})
	notify(map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "call_1", "status": "completed",
		"content": []any{map[string]any{"type": "content", "content": map[string]any{"type": "text", "text": "a.txt"}}}})
	var names []string
	for len(s.events) > 0 {
		if ev := <-s.events; ev.Type == core.EventToolResult {
			names = append(names, ev.ToolName)
		}
	}
	if len(names) != 1 || names[0] != "bash" {
		t.Fatalf("tool result labels = %q", names)
	}
}
