package acp

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Exercise the real RPC completion boundary, not just the filtering function.
// All payloads are synthetic; no private production output belongs in fixtures.
func TestPrivateOutput_NoPublicAnswerTerminal(t *testing.T) {
	type chunk struct{ kind, id, text string }
	for _, strict := range []bool{false, true} {
		for _, tc := range []struct {
			name    string
			chunks  []chunk
			private bool
		}{
			{"unclosed_thinking", []chunk{{text: "<thi"}, {text: "nking>PRIVATE"}}, true},
			{"closed_summary_whitespace", []chunk{{text: " \n<summary>PRIVATE</summary>\t"}}, true},
			{"unclosed_attribute", []chunk{{text: "<thinking reason='PRIVATE"}}, true},
			{"new_message", []chunk{{id: "a", text: "<analysis>PRIVATE"}, {id: "b", text: " \n"}}, true},
			{"tool_boundary", []chunk{{text: "<thinking>PRIVATE"}, {kind: "tool_call"}}, true},
			{"public_before_private", []chunk{{id: "a", text: "公开答复"}, {id: "b", text: "<summary>PRIVATE"}}, false},
			{"public_after_private", []chunk{{id: "a", text: "<thinking>PRIVATE"}, {id: "b", text: "公开答复"}}, false},
			{"public_after_tool", []chunk{{text: "<thinking>PRIVATE"}, {kind: "tool_call"}, {text: "公开答复"}}, false},
			{"public_details", []chunk{{text: "<details><summary>标题</summary>正文</details>"}}, false},
			{"code_example", []chunk{{text: "~~~xml\n<thinking>example</thinking>\n~~~"}}, false},
			{"intentional_silence", []chunk{{text: "<thinking>PRIVATE</thinking>NO_REPLY"}}, false},
			{"no_filter_evidence", nil, false},
		} {
			t.Run(fmt.Sprintf("strict=%v/%s", strict, tc.name), func(t *testing.T) {
				s, responses, requests := newTestSession(t, nil)
				go func() {
					dec, enc := json.NewDecoder(requests), json.NewEncoder(responses)
					for turn := 0; turn < 2; turn++ {
						var req inputRPCRequest
						if dec.Decode(&req) != nil {
							return
						}
						chunks := tc.chunks
						if turn == 1 {
							chunks = []chunk{{text: "下一轮正常回复"}}
						}
						for _, c := range chunks {
							kind := c.kind
							if kind == "" {
								kind = "agent_message_chunk"
							}
							if enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
								"sessionId": "test-session-id", "update": map[string]any{"sessionUpdate": kind, "messageId": c.id, "toolCallId": "synthetic-tool", "content": map[string]string{"type": "text", "text": c.text}},
							}}) != nil {
								return
							}
						}
						if enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"stopReason": "end_turn"}}) != nil {
							return
						}
					}
				}()
				for turn := 0; turn < 2; turn++ {
					done := make(chan error, 1)
					go func() {
						if strict {
							done <- s.SendResumed("test", "m", nil, nil, "test-session-id")
						} else {
							done <- s.Send("test", "m", nil, nil)
						}
					}()
					select {
					case err := <-done:
						if err != nil {
							t.Fatalf("completed RPC must report reply failure only through Events: %v", err)
						}
					case <-time.After(3 * time.Second):
						t.Fatal("prompt timed out")
					}
					wantError := turn == 0 && tc.private
					failures, successes := 0, 0
					var public strings.Builder
					for len(s.events) > 0 {
						ev := <-s.events
						switch ev.Type {
						case core.EventError:
							failures++
							if !errors.Is(ev.Error, core.ErrNoPublicAnswer) || ev.Content != "" || ev.SessionID != "test-session-id" {
								t.Fatalf("missing safe typed failure: %+v", ev)
							}
						case core.EventResult:
							successes++
						case core.EventText:
							public.WriteString(ev.Content)
						}
					}
					if failures+successes != 1 || (failures == 1) != wantError {
						t.Fatalf("turn=%d failures=%d successes=%d wantError=%v", turn, failures, successes, wantError)
					}
					if strings.Contains(public.String(), "PRIVATE") || turn == 1 && public.String() != "下一轮正常回复" {
						t.Fatal("private text leaked or next turn lost")
					}
					if !s.Alive() || s.CurrentSessionID() != "test-session-id" {
						t.Fatal("reply failure discarded the original session")
					}
				}
			})
		}
	}
}

func TestPrivateOutput_CompletionSnapshotExcludesLateNotification(t *testing.T) {
	for _, strict := range []bool{false, true} {
		t.Run(fmt.Sprint(strict), func(t *testing.T) {
			s, responses, requests := newTestSession(t, nil)
			go func() {
				var req inputRPCRequest
				if json.NewDecoder(requests).Decode(&req) != nil {
					return
				}
				// Hold Send at the reader's completion callback, then deliver an
				// out-of-turn update before Send can examine the terminal result.
				s.tr.pendingMu.Lock()
				pending := s.tr.pending[string(req.ID)]
				complete := pending.complete
				pending.complete = func() {
					complete()
					late, _ := json.Marshal(inputUpdate("test-session-id", "late public text")["params"])
					s.onNotification("session/update", late)
				}
				s.tr.pending[string(req.ID)] = pending
				s.tr.pendingMu.Unlock()
				enc := json.NewEncoder(responses)
				_ = enc.Encode(inputUpdate("test-session-id", "<thinking>PRIVATE"))
				_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"stopReason": "end_turn"}})
			}()
			done := make(chan error, 1)
			go func() {
				if strict {
					done <- s.SendResumed("test", "m", nil, nil, "test-session-id")
				} else {
					done <- s.Send("test", "m", nil, nil)
				}
			}()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("prompt timed out")
			}
			failures := 0
			for len(s.events) > 0 {
				ev := <-s.events
				if ev.Type == core.EventResult {
					t.Fatal("late notification turned failure into success")
				}
				if ev.Type == core.EventError && errors.Is(ev.Error, core.ErrNoPublicAnswer) {
					failures++
				}
				if strict && ev.Type == core.EventText {
					t.Fatal("strict prompt accepted out-of-turn text")
				}
			}
			if failures != 1 {
				t.Fatalf("failures=%d", failures)
			}
		})
	}
}
