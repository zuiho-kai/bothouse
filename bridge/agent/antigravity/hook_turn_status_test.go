package antigravity

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// Synthetic protocol replay: PreInvocation injects user_input into the same
// running Send. Keep failures on both sides of that input inside the boundary.
const hookInputTrajectory = `{
 "status":"CASCADE_RUN_STATUS_IDLE", "numTotalSteps":8,
 "trajectory":{"cascadeId":"fixture-conversation","steps":[
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_ERROR_MESSAGE","status":"CORTEX_STEP_STATUS_DONE","errorMessage":{"error":{"shortError":"old error"}}},
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_RUN_COMMAND","status":"CORTEX_STEP_STATUS_DONE","runCommand":{"exitCode":0}},
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_PLANNER_RESPONSE","status":"CORTEX_STEP_STATUS_DONE","plannerResponse":{"stopReason":"STOP_REASON_STOP_PATTERN"}},
  {"type":"CORTEX_STEP_TYPE_RUN_COMMAND","status":"CORTEX_STEP_STATUS_DONE","runCommand":{"exitCode":0}},
  {"type":"CORTEX_STEP_TYPE_PLANNER_RESPONSE","status":"CORTEX_STEP_STATUS_DONE","plannerResponse":{"response":"fixture answer","stopReason":"STOP_REASON_STOP_PATTERN"}}
 ]}}`

func TestStreamSession_HookInputKeepsWholeTurnEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, status, diagnostic string
		mutate                   func(*nativeTrajectory)
	}{
		{name: "clean-hook-input", status: "ERROR"},
		{name: "ordinary-success", status: "SUCCESS"},
		{name: "upstream-interruption-then-answer", status: "ERROR", diagnostic: "stream_step=5 kind=upstream-stream-interrupted", mutate: func(n *nativeTrajectory) {
			n.Trajectory.Steps[5].PlannerResponse.StopReason = "STOP_REASON_CLIENT_STREAM_ERROR"
			n.Trajectory.Steps[6].Type = "CORTEX_STEP_TYPE_ERROR_MESSAGE"
			n.Trajectory.Steps[6].RunCommand.ExitCode = nil
		}},
		{name: "command-before-input", status: "ERROR", diagnostic: "command_step=3 exit_code=128", mutate: func(n *nativeTrajectory) {
			exit := 128
			n.Trajectory.Steps[3].RunCommand.ExitCode = &exit
		}},
		{name: "command-after-input", status: "ERROR", diagnostic: "command_step=6 exit_code=1", mutate: func(n *nativeTrajectory) {
			exit := 1
			n.Trajectory.Steps[6].RunCommand.ExitCode = &exit
		}},
		{name: "tool-error", status: "ERROR", diagnostic: "stream turn failed", mutate: func(n *nativeTrajectory) {
			n.Trajectory.Steps[3].Status = "CORTEX_STEP_STATUS_ERROR"
		}},
		{name: "cancelled", status: "CANCELLED", diagnostic: "stream turn failed"},
		{name: "wrong-trajectory", status: "ERROR", diagnostic: "stream turn failed", mutate: func(n *nativeTrajectory) {
			n.Trajectory.CascadeID = "other"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var trajectory nativeTrajectory
			if err := json.Unmarshal([]byte(hookInputTrajectory), &trajectory); err != nil {
				t.Fatal(err)
			}
			if tc.mutate != nil {
				tc.mutate(&trajectory)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("x-codeium-csrf-token") != "fixture-csrf" {
					t.Error("unauthenticated trajectory query")
				}
				_ = json.NewEncoder(w).Encode(trajectory)
			}))
			defer server.Close()
			base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "fixture-conversation", nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer base.Close()
			s := &streamSession{antigravitySession: base, busy: true, quota: &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"}}
			for i, typ := range []string{"user_input", "tool_call", "user_input", "agent_response", "tool_call", "agent_response"} {
				if tc.name == "upstream-interruption-then-answer" && i == 4 {
					typ = "error_message"
				}
				raw := fmt.Sprintf(`{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":%d,"state":"DONE","step_type":%q}}`, i+2, typ)
				var ev agyStreamEvent
				if err := json.Unmarshal([]byte(raw), &ev); err != nil {
					t.Fatal(err)
				}
				s.handleStreamEvent(ev)
			}
			var result agyStreamEvent
			result.Event = "result"
			result.Result.ConversationID = "fixture-conversation"
			result.Result.Status, result.Result.Response, result.Result.Error = tc.status, "fixture answer", "private-fixture-token"
			s.handleStreamEvent(result)
			terminal := <-s.events
			if tc.diagnostic == "" {
				if terminal.Type != core.EventResult || !terminal.Done {
					t.Fatalf("clean hook turn was rejected: %+v", terminal)
				}
			} else {
				if terminal.Type != core.EventError || terminal.Error == nil {
					t.Fatalf("real failure was hidden: %+v", terminal)
				}
				if !strings.Contains(terminal.Error.Error(), tc.diagnostic) {
					t.Errorf("missing cause %q: %v", tc.diagnostic, terminal.Error)
				}
				if strings.Contains(terminal.Error.Error(), "private-fixture-token") {
					t.Fatal("provider diagnostic leaked")
				}
			}
			if terminal.Content != "fixture answer" || s.busy {
				t.Fatalf("lost answer or retained turn: %+v", terminal)
			}
		})
	}
}
