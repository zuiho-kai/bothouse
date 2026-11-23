package acp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// #2041: the server runs a slash command only when the prompt is exactly that command. The
// session must know the advertised commands and send one without the model-control instructions.
// A command that declared no input is that command only alone: the server runs it whatever
// follows, so the rest of "/context why is it so big" was lost. Names match as the server
// matches them, by case.
func TestNativeCommandIsSentAsTyped(t *testing.T) {
	a := &Agent{}
	s, responses, requests := newTestSession(t, a)
	s.onNotification("session/update", json.RawMessage(`{"sessionId":"test-session-id","update":{"sessionUpdate":"available_commands_update",
		"availableCommands":[{"name":"context","description":"Show context window usage"},{"name":"goal","input":{"hint":"[objective]"}}]}}`))

	for text, want := range map[string]string{
		"/context":                  "context",
		"  /context \n":             "context",
		"/goal":                     "goal",
		"/goal ship it":             "goal",
		"/context why is it so big": "",
		"/Context":                  "",
		"/contextual":               "",
		"/unknown":                  "",
		"context":                   "",
		"/context\nand more":        "",
		"see /context":              "",
	} {
		if got, readOnly := a.NativeCommand(context.Background(), text); got != want || readOnly {
			t.Errorf("NativeCommand(%q) = %q, %v; want %q, false", text, got, readOnly, want)
		}
	}
	if len(s.events) != 0 {
		t.Fatalf("the command list was passed on as %d turn event(s)", len(s.events))
	}

	prompts := make(chan string, 2)
	go func() {
		dec, enc := json.NewDecoder(requests), json.NewEncoder(responses)
		for {
			var req struct {
				ID     json.RawMessage
				Params struct{ Prompt []struct{ Text string } }
			}
			if dec.Decode(&req) != nil {
				return
			}
			prompts <- req.Params.Prompt[0].Text
			_ = enc.Encode(inputUpdate("test-session-id", "ok"))
			_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"stopReason": "end_turn"}})
		}
	}()

	for _, text := range []string{"/context", "hello"} {
		if err := s.Send(text, "m", nil, nil); err != nil {
			t.Fatal(err)
		}
	}
	// #1903: the engine adds the model skill (once per context); the session sends prompts as typed.
	for _, want := range []struct {
		text    string
		asTyped bool
	}{{"/context", true}, {"hello", true}} {
		select {
		case got := <-prompts:
			if (got == want.text) != want.asTyped {
				t.Errorf("prompt for %q reached the server as %q", want.text, got)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("no prompt for %q", want.text)
		}
	}
}
