package antigravity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

const historicalError = "FAILED_PRECONDITION (code 400): User location is not supported for the API use."

// Synthetic fixture preserves the observed agy 1.4.0 protocol, not user content.
const recoveredTrajectory = `{
 "status":"CASCADE_RUN_STATUS_IDLE", "numTotalSteps":5,
 "trajectory":{"cascadeId":"fixture-conversation","steps":[
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_ERROR_MESSAGE","status":"CORTEX_STEP_STATUS_DONE","errorMessage":{"error":{"shortError":"FAILED_PRECONDITION (code 400): User location is not supported for the API use."}}},
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_SYSTEM_MESSAGE","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_PLANNER_RESPONSE","status":"CORTEX_STEP_STATUS_DONE","plannerResponse":{"response":"CONEST_PROBE_OK","stopReason":"STOP_REASON_STOP_PATTERN"}}
 ]}}
`

func TestStreamSession_HistoricalErrorDoesNotPoisonCompletedTurn(t *testing.T) {
	runTurnStatusFixture(t, recoveredTrajectory, historicalError, "ERROR", "CONEST_PROBE_OK", true, 200)
}

func TestStreamSession_HistoricalErrorResultNewline(t *testing.T) {
	runTurnStatusFixture(t, recoveredTrajectory, historicalError, "ERROR", "CONEST_PROBE_OK\n", true, 200)
}

func runTurnStatusFixture(t *testing.T, trajectory, resultError, status, response string, wantSuccess bool, httpStatus int) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "POST" || r.URL.Path != "/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory" || r.Header.Get("x-codeium-csrf-token") != "fixture-csrf" {
			t.Error("invalid trajectory request")
		}
		var request map[string]string
		if json.NewDecoder(r.Body).Decode(&request) != nil || request["cascadeId"] != "fixture-conversation" {
			t.Error("wrong conversation requested")
		}
		w.WriteHeader(httpStatus)
		_, _ = io.WriteString(w, trajectory)
	}))
	defer server.Close()
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "fixture-conversation", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	s := &streamSession{antigravitySession: base, busy: true, quota: &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"}}
	for _, raw := range []string{
		`{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":2,"state":"DONE","step_type":"user_input"}}`,
		`{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":3,"state":"DONE","step_type":"system_message"}}`,
		`{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":4,"state":"DONE","step_type":"agent_response","text_delta":"CONEST_PROBE_OK"}}`,
		fmt.Sprintf(`{"event":"result","result":{"conversation_id":"fixture-conversation","status":%q,"response":%q,"error":%q}}`, status, response, resultError),
	} {
		var event agyStreamEvent
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			t.Fatal(err)
		}
		s.handleStreamEvent(event)
	}
	var terminal core.Event
	for len(s.events) > 0 {
		e := <-s.events
		if e.Type == core.EventError || e.Type == core.EventResult {
			terminal = e
		}
	}
	if wantSuccess {
		if terminal.Type != core.EventResult || !terminal.Done || terminal.Content != "" || terminal.SessionID != "fixture-conversation" {
			t.Fatalf("completed current turn became failure or duplicate response: %+v", terminal)
		}
		if status == "ERROR" && calls.Load() != 1 {
			t.Fatalf("success must require exactly one fresh authenticated trajectory query, got %d", calls.Load())
		}
	} else if terminal.Type != core.EventError || terminal.Error == nil {
		t.Fatalf("unverified/failed turn was promoted: %+v", terminal)
	}
	if s.busy {
		t.Fatal("terminal did not release the turn")
	}
}

func TestStreamSession_HistoricalErrorVerificationFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name, trajectory, err, status, response string
		http                                    int
	}{
		{"current-error", strings.Replace(recoveredTrajectory, `"CORTEX_STEP_TYPE_SYSTEM_MESSAGE"`, `"CORTEX_STEP_TYPE_ERROR_MESSAGE"`, 1), historicalError, "ERROR", "CONEST_PROBE_OK", 200},
		{"current-tool-failed", strings.Replace(recoveredTrajectory, `"type":"CORTEX_STEP_TYPE_SYSTEM_MESSAGE","status":"CORTEX_STEP_STATUS_DONE"`, `"type":"CORTEX_STEP_TYPE_RUN_COMMAND","status":"CORTEX_STEP_STATUS_ERROR"`, 1), historicalError, "ERROR", "CONEST_PROBE_OK", 200},
		{"unknown-error", recoveredTrajectory, "new failure", "ERROR", "CONEST_PROBE_OK", 200},
		{"no-error-detail", recoveredTrajectory, "", "ERROR", "CONEST_PROBE_OK", 200},
		{"empty-answer", recoveredTrajectory, historicalError, "ERROR", "", 200},
		{"different-answer", recoveredTrajectory, historicalError, "ERROR", "different response", 200},
		{"running", strings.ReplaceAll(recoveredTrajectory, "CASCADE_RUN_STATUS_IDLE", "CASCADE_RUN_STATUS_RUNNING"), historicalError, "ERROR", "CONEST_PROBE_OK", 200},
		{"truncated", strings.Replace(recoveredTrajectory, `"numTotalSteps":5`, `"numTotalSteps":8`, 1), historicalError, "ERROR", "CONEST_PROBE_OK", 200},
		{"wrong-conversation", strings.ReplaceAll(recoveredTrajectory, "fixture-conversation", "other"), historicalError, "ERROR", "CONEST_PROBE_OK", 200},
		{"cancelled", recoveredTrajectory, historicalError, "CANCELLED", "CONEST_PROBE_OK", 200},
		{"no-matching-history", strings.ReplaceAll(recoveredTrajectory, historicalError, "other old error"), historicalError, "ERROR", "CONEST_PROBE_OK", 200},
		{"unknown-stop", strings.ReplaceAll(recoveredTrajectory, "STOP_REASON_STOP_PATTERN", "STOP_REASON_MAX_TOKENS"), historicalError, "ERROR", "CONEST_PROBE_OK", 200},
		{"rpc-failed", `private fixture credential`, historicalError, "ERROR", "CONEST_PROBE_OK", 500},
		{"rpc-malformed", `not json`, historicalError, "ERROR", "CONEST_PROBE_OK", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runTurnStatusFixture(t, tc.trajectory, tc.err, tc.status, tc.response, false, tc.http)
		})
	}
}

func TestStreamTurnEvidenceRequiresCurrentTurnIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, first, next string
	}{
		{"missing-index", `{"conversation_id":"fixture-conversation","state":"DONE","step_type":"user_input"}`, ""},
		{"missing-conversation", `{"step_index":2,"state":"DONE","step_type":"user_input"}`, ""},
		{"missing-boundary", `{"conversation_id":"fixture-conversation","step_index":4,"state":"DONE","step_type":"agent_response"}`, ""},
		{"replayed-history", `{"conversation_id":"fixture-conversation","step_index":2,"state":"DONE","step_type":"user_input"}`, `{"conversation_id":"fixture-conversation","step_index":1,"state":"DONE","step_type":"agent_response"}`},
		{"other-conversation", `{"conversation_id":"fixture-conversation","step_index":2,"state":"DONE","step_type":"user_input"}`, `{"conversation_id":"other","step_index":4,"state":"DONE","step_type":"agent_response"}`},
		{"second-input", `{"conversation_id":"fixture-conversation","step_index":2,"state":"DONE","step_type":"user_input"}`, `{"conversation_id":"fixture-conversation","step_index":3,"state":"DONE","step_type":"user_input"}`},
		{"denied", `{"conversation_id":"fixture-conversation","step_index":2,"state":"DONE","step_type":"user_input"}`, `{"conversation_id":"fixture-conversation","step_index":3,"state":"DENIED","step_type":"tool_call"}`},
		{"error-message", `{"conversation_id":"fixture-conversation","step_index":2,"state":"DONE","step_type":"user_input"}`, `{"conversation_id":"fixture-conversation","step_index":3,"state":"DONE","step_type":"error_message"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var evidence streamTurnEvidence
			for _, step := range []string{tc.first, tc.next} {
				if step == "" {
					continue
				}
				var ev agyStreamEvent
				if err := json.Unmarshal([]byte(`{"event":"step_update","step_update":`+step+`}`), &ev); err != nil {
					t.Fatal(err)
				}
				evidence.observe(ev)
			}
			if !evidence.invalid {
				t.Fatal("invalid turn evidence accepted")
			}
		})
	}
}

func TestNativeTrajectoryNeverReusesSuccessfulTurn(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			_, _ = io.WriteString(w, recoveredTrajectory)
		} else {
			_, _ = io.WriteString(w, strings.Replace(recoveredTrajectory, "CORTEX_STEP_TYPE_SYSTEM_MESSAGE", "CORTEX_STEP_TYPE_ERROR_MESSAGE", 1))
		}
	}))
	defer server.Close()
	q := &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"}
	evidence := streamTurnEvidence{conversationID: "fixture-conversation", start: 2, last: 4, seen: true, finalResponse: true}
	for i := 0; i < 2; i++ {
		trajectory, err := q.trajectory(context.Background(), evidence.conversationID)
		if err != nil {
			t.Fatal(err)
		}
		if got := trajectory.confirmsHistoricalError(evidence, historicalError, "CONEST_PROBE_OK"); got != (i == 0) {
			t.Fatalf("turn %d reused stale success", i)
		}
	}
	q.close()
	if _, err := q.trajectory(context.Background(), evidence.conversationID); err == nil {
		t.Fatal("closed CLI supplied terminal evidence")
	}
	if calls.Load() != 2 {
		t.Fatalf("native calls=%d", calls.Load())
	}
}

func TestNativeTrajectoryTransportRejectsRedirectAndOversize(t *testing.T) {
	var followed atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { followed.Store(true) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("redirect") == "yes" {
			http.Redirect(w, r, target.URL, http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, strings.Repeat("fixture-private", 100))
	}))
	defer server.Close()
	for _, address := range []string{server.URL, server.URL + "?redirect=yes&path="} {
		_, err := fetchNativeRPC(context.Background(), address, "fixture-csrf", "GetCascadeTrajectory", []byte("{}"), 16)
		if err == nil || strings.Contains(err.Error(), "fixture-private") || strings.Contains(err.Error(), "fixture-csrf") {
			t.Fatal("transport accepted invalid data or exposed secrets")
		}
	}
	if followed.Load() {
		t.Fatal("native request followed a redirect")
	}
}
