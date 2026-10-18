package antigravity

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestStreamSession_EmptySuccessIsError(t *testing.T) {
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "existing", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	s := &streamSession{antigravitySession: base, busy: true}
	ev := agyStreamEvent{Event: "result"}
	ev.Result.Status = "SUCCESS"
	s.handleStreamEvent(ev)
	got := <-s.Events()
	if got.Type != core.EventError || !errors.Is(got.Error, core.ErrEmptyAgentResponse) {
		t.Fatalf("empty success reported as a completed answer: %+v", got)
	}
	if s.busy {
		t.Fatal("empty result leaves turn busy")
	}
}

func TestStreamSession_WhitespaceDoesNotHideResult(t *testing.T) {
	for _, response := range []string{"whole answer", " \n\t"} {
		t.Run(strings.TrimSpace(response), func(t *testing.T) {
			base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "existing", nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer base.Close()
			s := &streamSession{antigravitySession: base, busy: true}
			step := agyStreamEvent{Event: "step_update"}
			step.Step.Type, step.Step.TextDelta = "agent_response", " \n"
			s.handleStreamEvent(step)
			<-s.Events()
			ev := agyStreamEvent{Event: "result"}
			ev.Result.Status, ev.Result.Response = "SUCCESS", response
			s.handleStreamEvent(ev)
			got := <-s.Events()
			if strings.TrimSpace(response) == "" {
				if !errors.Is(got.Error, core.ErrEmptyAgentResponse) {
					t.Fatalf("blank answer accepted: %+v", got)
				}
			} else if got.Type != core.EventResult || got.Content != response {
				t.Fatalf("final answer lost after whitespace: %+v", got)
			}
		})
	}
}

func TestStreamSession_EmptyTurnDoesNotRetryAndNextTurnRecovers(t *testing.T) {
	s, err := newStreamSession(context.Background(), os.Args[0],
		[]string{"-test.run=^TestStreamSession_ReusesProcessAndSeparatesThoughts$", "--"},
		t.TempDir(), "", "default", "resume-123",
		[]string{"CC_AGY_STREAM_TEST=1", "CC_AGY_STREAM_FAILURE=empty-first"}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for turn, prompt := range []string{"prompt-1", "prompt-2"} {
		if err := s.Send(prompt, "msg", nil, nil); err != nil {
			t.Fatal(err)
		}
		var answer strings.Builder
		deadline := time.After(3 * time.Second)
	loop:
		for {
			select {
			case ev := <-s.Events():
				answer.WriteString(ev.Content)
				if ev.Type == core.EventError {
					if turn != 0 || !errors.Is(ev.Error, core.ErrEmptyAgentResponse) {
						t.Fatal(ev.Error)
					}
					break loop
				}
				if ev.Type == core.EventResult {
					if turn != 1 || answer.String() != "answer-2" {
						t.Fatalf("turn repeated or response lost: %q", answer.String())
					}
					break loop
				}
			case <-deadline:
				t.Fatal("turn blocked")
			}
		}
		if !s.Alive() || s.CurrentSessionID() != "resume-123" {
			t.Fatal("session lost after empty turn")
		}
	}
}
