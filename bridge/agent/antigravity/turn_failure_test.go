package antigravity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// Replays the observed current-turn pattern using synthetic IDs/text only.
const completedTaskFailureTrajectory = `{
 "status":"CASCADE_RUN_STATUS_IDLE", "numTotalSteps":6,
 "trajectory":{"cascadeId":"fixture-conversation","steps":[
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_ERROR_MESSAGE","status":"CORTEX_STEP_STATUS_DONE","errorMessage":{"error":{"shortError":"old error"}}},
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_RUN_COMMAND","status":"CORTEX_STEP_STATUS_DONE","runCommand":{"exitCode":0}},
  {"type":"CORTEX_STEP_TYPE_GENERIC","status":"CORTEX_STEP_STATUS_ERROR",
   "error":{"shortError":"cannot kill task \"fixture-conversation/task-3\": task is not running (status: DONE)"},
   "metadata":{"toolCall":{"name":"manage_task","argumentsJson":"{\"Action\":\"kill\",\"TaskId\":\"fixture-conversation/task-3\"}"}}},
  {"type":"CORTEX_STEP_TYPE_PLANNER_RESPONSE","status":"CORTEX_STEP_STATUS_DONE","plannerResponse":{"response":"read-only answer","stopReason":"STOP_REASON_STOP_PATTERN"}}
 ]}}
`

func TestStreamSession_CurrentToolFailurePreservesAnswerAndSafeCause(t *testing.T) {
	for _, tc := range []struct {
		name, trajectory string
		wantCause        bool
	}{
		{"completed-task-stop", completedTaskFailureTrajectory, true},
		{"other-error", strings.Replace(completedTaskFailureTrajectory, "cannot kill task", "private-fixture-token cannot kill task", 1), false},
		{"wrong-action", strings.Replace(completedTaskFailureTrajectory, `\"Action\":\"kill\"`, `\"Action\":\"wait\"`, 1), false},
		{"failed-command", strings.Replace(completedTaskFailureTrajectory, `"exitCode":0`, `"exitCode":1`, 1), false},
		{"missing-exit", strings.Replace(completedTaskFailureTrajectory, `"exitCode":0`, `"unknown":0`, 1), false},
		{"other-task", strings.ReplaceAll(completedTaskFailureTrajectory, "task-3", "task-0"), false},
		{"incomplete", strings.Replace(completedTaskFailureTrajectory, `"numTotalSteps":6`, `"numTotalSteps":9`, 1), false},
		{"different-answer", strings.Replace(completedTaskFailureTrajectory, `"response":"read-only answer"`, `"response":"other answer"`, 1), false},
		{"running", strings.Replace(completedTaskFailureTrajectory, "CASCADE_RUN_STATUS_IDLE", "CASCADE_RUN_STATUS_RUNNING", 1), false},
		{"cross-session", strings.Replace(completedTaskFailureTrajectory, `"cascadeId":"fixture-conversation"`, `"cascadeId":"other"`, 1), false},
		{"unavailable", "not json private-fixture-token", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory" || r.Header.Get("x-codeium-csrf-token") != "fixture-csrf" {
					t.Error("invalid native diagnostic request")
				}
				_, _ = io.WriteString(w, tc.trajectory)
			}))
			defer server.Close()
			base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "fixture-conversation", nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer base.Close()
			s := &streamSession{antigravitySession: base, busy: true, quota: &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"}}
			for i, typ := range []string{"user_input", "tool_call", "tool_call", "agent_response"} {
				state := "DONE"
				if i == 2 {
					state = "ERROR"
				}
				raw := fmt.Sprintf(`{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":%d,"state":%q,"step_type":%q}}`, i+2, state, typ)
				var ev agyStreamEvent
				if err := json.Unmarshal([]byte(raw), &ev); err != nil {
					t.Fatal(err)
				}
				s.handleStreamEvent(ev)
			}
			var ev agyStreamEvent
			if err := json.Unmarshal([]byte(`{"event":"result","result":{"conversation_id":"fixture-conversation","status":"ERROR","response":"read-only answer","error":"private-fixture-token"}}`), &ev); err != nil {
				t.Fatal(err)
			}
			s.handleStreamEvent(ev)
			terminal := <-s.events
			if terminal.Type != core.EventError || terminal.Error == nil {
				t.Fatalf("real failure was promoted: %+v", terminal)
			}
			if terminal.Content != "read-only answer" || terminal.SessionID != "fixture-conversation" {
				t.Fatalf("answer must be separate from error and bound to session: %+v", terminal)
			}
			diagnostic := terminal.Error.Error()
			if strings.Contains(diagnostic, "read-only answer") || strings.Contains(diagnostic, "private-fixture-token") || strings.Contains(diagnostic, "fixture-csrf") {
				t.Fatal("error mixed with answer or secret")
			}
			if got := strings.Contains(diagnostic, "task is already completed"); got != tc.wantCause {
				t.Errorf("safe cause=%t want %t; %s", got, tc.wantCause, diagnostic)
			}
			if s.busy {
				t.Fatal("failed turn did not release queue")
			}
		})
	}
}

func TestStreamSession_FailedStepCannotUseHistoricalRecovery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, recoveredTrajectory)
	}))
	defer server.Close()
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "fixture-conversation", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	s := &streamSession{antigravitySession: base, quota: &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"},
		turn: streamTurnEvidence{conversationID: "fixture-conversation", start: 2, last: 4, seen: true, failed: true, finalResponse: true}}
	var ev agyStreamEvent
	ev.Result.ConversationID = "fixture-conversation"
	ev.Result.Status, ev.Result.Error, ev.Result.Response = "ERROR", historicalError, "CONEST_PROBE_OK"
	if recovered, failure := s.verifyFailedTurn(ev); recovered || failure == nil {
		t.Fatal("a clean native snapshot must not erase a failure observed in the current stream")
	}
}
