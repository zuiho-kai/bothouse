package acp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func privateOutputSession() *acpSession {
	return &acpSession{ctx: context.Background(), events: make(chan core.Event, 128), acpSessID: "fixture", toolInputByID: map[string]string{}}
}

func privateOutputNotify(s *acpSession, kind, id, text string) {
	p, _ := json.Marshal(map[string]any{"sessionId": "fixture", "update": map[string]any{"sessionUpdate": kind, "messageId": id, "content": map[string]string{"type": "text", "text": text}}})
	s.onNotification("session/update", p)
}

func privateOutputAnswer(s *acpSession) string {
	var b strings.Builder
	for len(s.events) > 0 {
		e := <-s.events
		if e.Type == core.EventText {
			b.WriteString(e.Content)
		}
	}
	return b.String()
}

// Synthetic versions of the observed ACP wire shape; no production text.
func TestPrivateOutput_NotificationBoundary(t *testing.T) {
	for _, fragments := range [][]string{
		{"<thinking>PRIVATE</thinking>答复"},
		{"<thi", "nking>PRIVATE", "</thin", "king>答复"},
		{"<thinking> </thinking>\n<thinking>PRIVATE never closed"},
		{"<analysis>PRIVATE</analysis>答复"},
		{"<analysis>PRIVATE</analysis>\n<summary>PRIVATE summary</summary>答复"},
		{"<summary>PRIVATE never closed"},
		{"<compacted-summary>PRIVATE</compacted-summary>答复"},
	} {
		s := privateOutputSession()
		for _, chunk := range fragments {
			privateOutputNotify(s, "agent_message_chunk", "m1", chunk)
		}
		got := privateOutputAnswer(s)
		if strings.Contains(got, "PRIVATE") || strings.Contains(got, "<thi") || strings.Contains(got, "<analysis>") {
			t.Fatalf("internal output reached reply channel: %q", got)
		}
		if strings.HasSuffix(strings.Join(fragments, ""), "答复") && !strings.HasSuffix(got, "答复") {
			t.Fatalf("lost answer: %q", got)
		}
		privateOutputNotify(s, "agent_message_chunk", "m2", "下一条正常回复")
		if got := privateOutputAnswer(s); got != "下一条正常回复" {
			t.Fatalf("private state poisoned next message: %q", got)
		}
	}
}

func TestPrivateOutput_UnknownInternalUpdateIsNotAReply(t *testing.T) {
	s := privateOutputSession()
	privateOutputNotify(s, "compaction_summary", "", "PRIVATE")
	if got := privateOutputAnswer(s); got != "" {
		t.Fatalf("unknown event was guessed to be public: %q", got)
	}
}

func TestPrivateOutput_AllChunkBoundaries(t *testing.T) {
	tick := string(rune(96))
	cases := []struct{ name, input, want string }{
		{"nested", "前<thinking>PRIVATE<analysis>PRIVATE</analysis>PRIVATE</thinking>后", "前后"},
		{"upper case", "<THINK>PRIVATE</THINK>正常", "正常"},
		{"mismatched close", "<thinking>PRIVATE</analysis>PRIVATE", ""},
		{"inline example", "示例 " + tick + "<thinking>example</thinking>" + tick + "<analysis>PRIVATE</analysis>公开", "示例 " + tick + "<thinking>example</thinking>" + tick + "公开"},
		{"double backtick", tick + tick + "<analysis>example" + tick + "</analysis>" + tick + tick + "<think>PRIVATE</think>好", tick + tick + "<analysis>example" + tick + "</analysis>" + tick + tick + "好"},
		{"fence", tick + tick + tick + "xml\n<thinking>example</thinking>\n" + tick + tick + tick + "\n<thinking>PRIVATE</thinking>好", tick + tick + tick + "xml\n<thinking>example</thinking>\n" + tick + tick + tick + "\n好"},
		{"tilde fence", "  ~~~xml\n<analysis>example</analysis>\n  ~~~\n<think>PRIVATE</think>好", "  ~~~xml\n<analysis>example</analysis>\n  ~~~\n好"},
		{"not a fence close", "~~~xml\n~~~suffix\n<thinking>example</thinking>\n~~~\n<analysis>PRIVATE</analysis>好", "~~~xml\n~~~suffix\n<thinking>example</thinking>\n~~~\n好"},
		{"ordinary markup", "x < 2，<div>内容</div>，<<unknown>，<中文>", "x < 2，<div>内容</div>，<<unknown>，<中文>"},
		{"hidden code", "<thinking>" + tick + tick + tick + "\nPRIVATE</thinking>好", "好"},
		{"unclosed", "<thinking>PRIVATE", ""},
		{"partial marker", "答复<compacted-sum", "答复"},
		{"summary", "<compacted-summary>PRIVATE</compacted-summary>好", "好"},
		{"bare summary", "<analysis>PRIVATE</analysis>\n<summary>PRIVATE</summary>好", "\n好"},
		{"summary attributes", "<SUMMARY kind='internal>memo'>PRIVATE</SUMMARY \n>好", "好"},
		{"summary nested", "<summary>PRIVATE<summary>PRIVATE</summary>PRIVATE</summary>好", "好"},
		{"summary unclosed", "前<summary>PRIVATE", "前"},
		{"hidden details", "<summary><details><summary>PRIVATE</summary></details>PRIVATE</summary><summary>PRIVATE</summary>好", "好"},
		{"hidden details close", "<details><analysis></details>PRIVATE</analysis><summary>标题</summary></details>", "<details><summary>标题</summary></details>"},
		{"details", "<details><summary>标题</summary>正文</details><summary>PRIVATE</summary>好", "<details><summary>标题</summary>正文</details>好"},
		{"details attributes", "<DETAILS open title='a>b'><SUMMARY class=title>标题</SUMMARY \t>正文</DETAILS \n><summary>PRIVATE</summary>", "<DETAILS open title='a>b'><SUMMARY class=title>标题</SUMMARY \t>正文</DETAILS \n>"},
		{"nested details", "<details><summary>外</summary><details open><summary>内</summary></details><summary>外</summary></details><summary>PRIVATE</summary>", "<details><summary>外</summary><details open><summary>内</summary></details><summary>外</summary></details>"},
		{"similar names", "<details-extra>正文</details-extra><summary>PRIVATE</summary>", "<details-extra>正文</details-extra>"},
		{"summary inline example", tick + "<details><summary>示例</summary></details>" + tick + "<summary>PRIVATE</summary>好", tick + "<details><summary>示例</summary></details>" + tick + "好"},
		{"summary fence example", "~~~html\n<details><summary>示例</summary>\n~~~\n<summary>PRIVATE</summary>好", "~~~html\n<details><summary>示例</summary>\n~~~\n好"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for split := 0; split <= len(tc.input); split++ {
				var f privateOutput
				got := f.feed(tc.input[:split]) + f.feed(tc.input[split:])
				if got != tc.want {
					t.Fatalf("split=%d got %q want %q", split, got, tc.want)
				}
			}
			var f privateOutput
			var b strings.Builder
			for i := 0; i < len(tc.input); i++ {
				b.WriteString(f.feed(tc.input[i : i+1]))
			}
			if b.String() != tc.want {
				t.Fatalf("byte stream got %q want %q", b.String(), tc.want)
			}
		})
	}
}

func TestPrivateOutput_SummaryContextMessageBoundary(t *testing.T) {
	for _, first := range []string{"<details><summary>公开</summary>", "<summary>PRIVATE", "<summary title='"} {
		s := privateOutputSession()
		privateOutputNotify(s, "agent_message_chunk", "m1", first)
		privateOutputAnswer(s)
		privateOutputNotify(s, "agent_message_chunk", "m2", "<summary>PRIVATE</summary>好")
		if got := privateOutputAnswer(s); got != "好" {
			t.Fatalf("message inherited context: %q", got)
		}
	}
}

func TestPrivateOutput_NoIDToolBoundaryAndThought(t *testing.T) {
	s := privateOutputSession()
	privateOutputNotify(s, "agent_message_chunk", "", "<summary>PRIVATE")
	privateOutputNotify(s, "agent_thought_chunk", "", "native reasoning")
	privateOutputNotify(s, "tool_call_update", "", "")
	privateOutputNotify(s, "agent_message_chunk", "", "PRIVATE continuation")
	if got := privateOutputAnswer(s); got != "" {
		t.Fatalf("unexpected output: %q", got)
	}
	privateOutputNotify(s, "tool_call", "", "")
	privateOutputNotify(s, "agent_message_chunk", "", "工具之后的回复")
	if got := privateOutputAnswer(s); got != "工具之后的回复" {
		t.Fatalf("lost reply: %q", got)
	}
}

func TestPrivateOutput_BoundedHiddenState(t *testing.T) {
	var f privateOutput
	if f.feed(strings.Repeat("<thinking>", 40)+strings.Repeat("PRIVATE", 10000)) != "" {
		t.Fatal("leaked hidden output")
	}
	if len(f.stack) > 32 || len(f.pending) > 20 {
		t.Fatal("unbounded hidden state")
	}
	if f.feed(strings.Repeat("</thinking>", 40)+"PRIVATE") != "" {
		t.Fatal("nesting overflow must fail closed")
	}
}

func TestPrivateOutput_PromptCompletionAndErrors(t *testing.T) {
	for _, strict := range []bool{false, true} {
		for _, ending := range []string{"end_turn", "cancelled", "rpc_error"} {
			t.Run(fmt.Sprintf("strict=%v/%s", strict, ending), func(t *testing.T) {
				s, responses, requests := newTestSession(t, nil)
				go func() {
					dec, enc := json.NewDecoder(requests), json.NewEncoder(responses)
					for i := 0; i < 2; i++ {
						var req inputRPCRequest
						if dec.Decode(&req) != nil {
							return
						}
						body := "<summary>PRIVATE without close"
						if i == 1 {
							body = "下一轮正常回复"
						}
						if enc.Encode(inputUpdate("test-session-id", body)) != nil {
							return
						}
						response := map[string]any{"jsonrpc": "2.0", "id": req.ID}
						if i == 0 && ending == "rpc_error" {
							response["error"] = map[string]any{"code": -32000, "message": "synthetic error"}
						} else {
							stop := "end_turn"
							if i == 0 {
								stop = ending
							}
							response["result"] = map[string]any{"stopReason": stop}
						}
						if enc.Encode(response) != nil {
							return
						}
					}
				}()
				for i := 0; i < 2; i++ {
					done := make(chan error, 1)
					go func() {
						if strict {
							done <- s.SendResumed("test", "test", nil, nil, "test-session-id")
						} else {
							done <- s.Send("test", "test", nil, nil)
						}
					}()
					select {
					case err := <-done:
						wantErr := i == 0 && (ending == "rpc_error" || (strict && ending == "cancelled"))
						if (err != nil) != wantErr {
							t.Fatalf("err=%v wantErr=%v", err, wantErr)
						}
					case <-time.After(3 * time.Second):
						t.Fatal("prompt timed out")
					}
					var public strings.Builder
					successes, failures := 0, 0
					for len(s.events) > 0 {
						ev := <-s.events
						switch ev.Type {
						case core.EventText:
							public.WriteString(ev.Content)
						case core.EventResult:
							successes++
						case core.EventError:
							failures++
							if errors.Is(ev.Error, core.ErrNoPublicAnswer) != (i == 0 && ending == "end_turn") {
								t.Fatalf("RPC/strict errors must take precedence: %v", ev.Error)
							}
						}
					}
					wantFailure := i == 0 && (ending != "cancelled" || strict)
					if successes+failures != 1 || (failures == 1) != wantFailure {
						t.Fatalf("unexpected terminal: success=%d failure=%d", successes, failures)
					}
					got := public.String()
					want := ""
					if i == 1 {
						want = "下一轮正常回复"
					}
					if got != want {
						t.Fatalf("turn %d reply=%q want=%q", i, got, want)
					}
					s.outputMu.Lock()
					pending := len(s.outputFilter.stack) > 0 || s.outputFilter.pending != ""
					s.outputMu.Unlock()
					if pending {
						t.Fatal("prompt completion did not clear private state")
					}
				}
			})
		}
	}
}

func TestPrivateOutput_CancelledTransportClearsState(t *testing.T) {
	s, responses, requests := newTestSession(t, nil)
	go func() {
		var req inputRPCRequest
		if json.NewDecoder(requests).Decode(&req) != nil {
			return
		}
		enc := json.NewEncoder(responses)
		_ = enc.Encode(inputUpdate("test-session-id", "<summary>PRIVATE"))
		// A non-text event proves the reader has consumed the preceding hidden block.
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
			"sessionId": "test-session-id", "update": map[string]any{"sessionUpdate": "agent_thought_chunk", "text": "barrier"},
		}})
	}()
	done := make(chan error, 1)
	go func() { done <- s.Send("test", "m", nil, nil) }()
	select {
	case ev := <-s.events:
		if ev.Type != core.EventThinking {
			t.Fatalf("unexpected event: %v", ev.Type)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("notification timed out")
	}
	s.cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled send unexpectedly succeeded")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled send did not return")
	}
	s.outputMu.Lock()
	defer s.outputMu.Unlock()
	if len(s.outputFilter.stack) != 0 || s.outputFilter.pending != "" {
		t.Fatal("cancelled transport retained hidden state")
	}
}
