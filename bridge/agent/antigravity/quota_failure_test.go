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
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// #873 replay fixtures. The typed fields are copied verbatim from the three
// refused turns of 2026-11-17 17:53-17:56 (notes/bug-dadoubao-stream-
// 20261117.evidence.json, conversations 04e87b9b…, 32f915dc…); provider prose is
// replaced so a test can prove none of it reaches the diagnostic.
const (
	quotaSurveyProse = "quota refusal fixture prose"
	quotaRetryInfo   = `{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"5070.325535089s"}`
)

func quotaErrorInfo(reason, model, delay, stamp string) string {
	return fmt.Sprintf(`{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":%q,"domain":"cloudcode-pa.googleapis.com","metadata":{"model":%q,"quotaResetDelay":%q,"quotaResetTimeStamp":%q,"uiMessage":"true"}}`, reason, model, delay, stamp)
}

// liveQuotaTrajectory is the shape the RPC returns: rpcErrorDetails plus the
// details document that repeats the provider error.
func liveQuotaTrajectory(cascadeID, record string) string {
	return fmt.Sprintf(`{"status":"CASCADE_RUN_STATUS_IDLE","numTotalSteps":2,
 "trajectory":{"cascadeId":%q,"steps":[
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_ERROR_MESSAGE","status":"CORTEX_STEP_STATUS_DONE","errorMessage":{"error":%s}}
 ]}}`, cascadeID, record)
}

// persistedQuotaRecord is the shape agy persists: the same typed entries, no
// details document.
func persistedQuotaRecord(code int, infos ...string) string {
	quoted := make([]string, 0, len(infos))
	for _, info := range infos {
		raw, _ := json.Marshal(info)
		quoted = append(quoted, string(raw))
	}
	return fmt.Sprintf(`{"errorCode":%d,"shortError":%q,"rpcErrorDetails":[%s]}`, code, quotaSurveyProse, strings.Join(quoted, ","))
}

func liveQuotaRecord(code int, infos ...string) string {
	var document []string
	for _, info := range infos {
		document = append(document, info)
	}
	details, _ := json.Marshal(map[string]any{"error": map[string]any{
		"code": code, "message": quotaSurveyProse, "status": "RESOURCE_EXHAUSTED",
		"details": json.RawMessage("[" + strings.Join(document, ",") + "]"),
	}})
	quoted := make([]string, 0, len(infos))
	for _, info := range infos {
		raw, _ := json.Marshal(info)
		quoted = append(quoted, string(raw))
	}
	return fmt.Sprintf(`{"errorCode":%d,"details":%s,"shortError":%q,"rpcErrorDetails":[%s]}`,
		code, quoteJSON(string(details)), quotaSurveyProse, strings.Join(quoted, ","))
}

func quoteJSON(s string) string {
	raw, _ := json.Marshal(s)
	return string(raw)
}

// quotaResultFeed plays one refused turn through the stream handler and returns
// the terminal event: the turn's own step updates, then agy's bare ERROR.
func quotaResultFeed(t *testing.T, trajectory, resultError string) (core.Event, int32) {
	t.Helper()
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-codeium-csrf-token") != "fixture-csrf" {
			t.Error("unauthenticated trajectory query")
		}
		calls++
		_, _ = io.WriteString(w, trajectory)
	}))
	t.Cleanup(server.Close)
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "fixture-conversation", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Close() })
	s := &streamSession{antigravitySession: base, busy: true, quota: &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"}}
	for _, raw := range []string{
		`{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":0,"state":"DONE","step_type":"user_input"}}`,
		`{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":1,"state":"ERROR","step_type":"error_message"}}`,
		fmt.Sprintf(`{"event":"result","result":{"conversation_id":"fixture-conversation","status":"ERROR","response":"","error":%q}}`, resultError),
	} {
		var ev agyStreamEvent
		if err := json.Unmarshal([]byte(raw), &ev); err != nil {
			t.Fatal(err)
		}
		s.handleStreamEvent(ev)
	}
	var terminal core.Event
	for len(s.events) > 0 {
		e := <-s.events
		if e.Type == core.EventError || e.Type == core.EventResult {
			terminal = e
		}
	}
	if s.busy {
		t.Fatal("terminal did not release the turn")
	}
	return terminal, calls
}

func assertQuotaNotice(t *testing.T, terminal core.Event, wantReset string) {
	t.Helper()
	if terminal.Type != core.EventError || terminal.Error == nil {
		t.Fatalf("refused turn was not an error: %+v", terminal)
	}
	reset, ok := core.QuotaExhaustedReset(terminal)
	if !ok || reset != wantReset {
		t.Fatalf("quota mark = %q, %v; want %q", reset, ok, wantReset)
	}
	if terminal.ErrorKind != core.ErrorKindPermanent {
		t.Fatalf("error kind = %q; a spent quota must not be retried", terminal.ErrorKind)
	}
	if terminal.ErrorStatus != 429 {
		t.Fatalf("error status = %d; want the upstream 429", terminal.ErrorStatus)
	}
	// The chat reaches the quota wording only through the mark; the diagnostic
	// itself stays the content-free text it was before.
	if got := terminal.Error.Error(); got != "antigravity: stream turn failed (ERROR)" {
		t.Fatalf("diagnostic = %q", got)
	}
}

// The three original failures: same typed record, three different countdowns.
func TestStreamSession_QuotaRefusalReplay(t *testing.T) {
	stamp := "2026-11-17T08:18:06Z"
	for _, tc := range []struct {
		name, model, delay, want string
		live                     bool
	}{
		{"conv1-flash-live", "gemini-3.8-flash-high", "1h24m30.325535089s", "1h24m30s", true},
		{"conv2-hydrogen-persisted", "gemini-4-hydrogen-high", "1h22m21.819149576s", "1h22m21s", false},
		{"conv2-hydrogen-live", "gemini-4-hydrogen-high", "1h21m52.173758555s", "1h21m52s", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			info := quotaErrorInfo("QUOTA_EXHAUSTED", tc.model, tc.delay, stamp)
			var record, trajectory string
			if tc.live {
				record = liveQuotaRecord(429, info, quotaRetryInfo)
			} else {
				record = persistedQuotaRecord(429, info, quotaRetryInfo)
			}
			trajectory = liveQuotaTrajectory("fixture-conversation", record)
			terminal, _ := quotaResultFeed(t, trajectory, quotaSurveyProse)
			assertQuotaNotice(t, terminal, tc.want)
			// The engine reads this field as a duration (core.quotaResetTime), so
			// the chat text and the cooldown window both get a real deadline.
			if _, err := time.ParseDuration(tc.want); err != nil {
				t.Fatalf("reset %q is not a duration the engine can read: %v", tc.want, err)
			}
			// Only the countdown is relayed; nothing the provider wrote.
			for _, prose := range []string{quotaSurveyProse, "RESOURCE_EXHAUSTED", "quotaResetDelay", "cloudcode-pa"} {
				if strings.Contains(terminal.Error.Error(), prose) {
					t.Fatalf("diagnostic relays provider content %q: %v", prose, terminal.Error)
				}
			}
		})
	}
}

// A refusal that names only the cycle end still gives the chat a reset time.
func TestStreamSession_QuotaRefusalTimestampFallback(t *testing.T) {
	info := quotaErrorInfo("QUOTA_EXHAUSTED", "gemini-3.8-flash-high", "", "2026-11-17T08:18:06Z")
	terminal, _ := quotaResultFeed(t, liveQuotaTrajectory("fixture-conversation", liveQuotaRecord(429, info)), quotaSurveyProse)
	assertQuotaNotice(t, terminal, "2026-11-17T08:18:06Z")
}

// Everything below must stay a generic failure: guessing a quota from a 429 or
// from the provider's prose is exactly what #873 forbids.
func TestStreamSession_QuotaRefusalRequiresTypedRecord(t *testing.T) {
	for _, tc := range []struct{ name, trajectory string }{
		{"429-rate-limit", liveQuotaTrajectory("fixture-conversation",
			liveQuotaRecord(429, quotaErrorInfo("RATE_LIMIT_EXCEEDED", "gemini-3.8-flash-high", "30s", "2026-11-17T08:18:06Z")))},
		{"quota-reason-without-429", liveQuotaTrajectory("fixture-conversation",
			liveQuotaRecord(400, quotaErrorInfo("QUOTA_EXHAUSTED", "gemini-3.8-flash-high", "1h24m30s", "2026-11-17T08:18:06Z")))},
		{"prose-only", liveQuotaTrajectory("fixture-conversation",
			fmt.Sprintf(`{"errorCode":429,"shortError":%q}`, "RESOURCE_EXHAUSTED (code 429): quota reached. Resets in 1h24m30s."))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			terminal, _ := quotaResultFeed(t, tc.trajectory, "RESOURCE_EXHAUSTED (code 429): quota reached. Resets in 1h24m30s.")
			if terminal.Type != core.EventError || terminal.Error == nil {
				t.Fatalf("expected the generic failure: %+v", terminal)
			}
			if reset, ok := core.QuotaExhaustedReset(terminal); ok {
				t.Fatalf("untyped refusal marked as quota reset %q", reset)
			}
			if terminal.ErrorKind != "" || terminal.ErrorStatus != 0 {
				t.Fatalf("untyped refusal classified: kind=%q status=%d", terminal.ErrorKind, terminal.ErrorStatus)
			}
		})
	}
}

// An errorMessage from an earlier turn must never explain this turn's failure.
func TestStreamSession_QuotaRefusalIgnoresEarlierTurn(t *testing.T) {
	earlier := persistedQuotaRecord(429, quotaErrorInfo("QUOTA_EXHAUSTED", "gemini-3.8-flash-high", "1h24m30s", "2026-11-17T08:18:06Z"))
	current := persistedQuotaRecord(400, `{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"BAD_REQUEST"}`)
	trajectory := fmt.Sprintf(`{"status":"CASCADE_RUN_STATUS_IDLE","numTotalSteps":4,
 "trajectory":{"cascadeId":"fixture-conversation","steps":[
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_ERROR_MESSAGE","status":"CORTEX_STEP_STATUS_DONE","errorMessage":{"error":%s}},
  {"type":"CORTEX_STEP_TYPE_USER_INPUT","status":"CORTEX_STEP_STATUS_DONE"},
  {"type":"CORTEX_STEP_TYPE_ERROR_MESSAGE","status":"CORTEX_STEP_STATUS_ERROR","errorMessage":{"error":%s}}
 ]}}`, earlier, current)
	terminal := feedSteps(t, trajectory, `{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":2,"state":"DONE","step_type":"user_input"}}`,
		`{"event":"step_update","step_update":{"conversation_id":"fixture-conversation","step_index":3,"state":"ERROR","step_type":"error_message"}}`)
	if reset, ok := core.QuotaExhaustedReset(terminal); ok {
		t.Fatalf("earlier turn's quota attributed to this turn: %q", reset)
	}
	if terminal.Error == nil || terminal.Error.Error() != "antigravity: stream turn failed (ERROR)" {
		t.Fatalf("diagnostic = %v", terminal.Error)
	}
}

// An unreadable native record must fail closed: the generic failure and the
// ordinary retry rules stay exactly as they were.
func TestStreamSession_QuotaRefusalTrajectoryUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "fixture-conversation", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Close() })
	s := &streamSession{antigravitySession: base, busy: true, quota: &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"}}
	s.turn = streamTurnEvidence{conversationID: "fixture-conversation", start: 0, last: 1, seen: true, failed: true}
	var ev agyStreamEvent
	ev.Result.ConversationID, ev.Result.Status, ev.Result.Response = "fixture-conversation", "ERROR", ""
	if success, failure := s.verifyFailedTurn(ev); success || failure == nil {
		t.Fatal("unreadable record must retain the failure")
	} else if reset, ok := quotaFailureOf(failure); ok {
		t.Fatalf("unreadable record marked as quota reset %q", reset)
	}
}

// feedSteps is quotaResultFeed with a caller-chosen start (an earlier turn in
// the same conversation).
func feedSteps(t *testing.T, trajectory string, steps ...string) core.Event {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, trajectory)
	}))
	t.Cleanup(server.Close)
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "fixture-conversation", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Close() })
	s := &streamSession{antigravitySession: base, busy: true, quota: &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"}}
	feed := append([]string{}, steps...)
	feed = append(feed, `{"event":"result","result":{"conversation_id":"fixture-conversation","status":"ERROR","response":"","error":"quota refusal fixture prose"}}`)
	for _, raw := range feed {
		var ev agyStreamEvent
		if err := json.Unmarshal([]byte(raw), &ev); err != nil {
			t.Fatal(err)
		}
		s.handleStreamEvent(ev)
	}
	terminal := <-s.events
	if s.busy {
		t.Fatal("terminal did not release the turn")
	}
	return terminal
}

// The reset strings the classifier emits must be readable by the engine: the
// chat text and the cooldown window both parse this field.
func TestQuotaFailureResetParsesAsDuration(t *testing.T) {
	for _, tc := range []struct{ name, raw, want string }{
		{"live-sub-second", "1h24m30.325535089s", "1h24m30s"},
		{"live-sub-second-2", "1h22m21.819149576s", "1h22m21s"},
		{"already-whole", "1h21m52s", "1h21m52s"},
		{"sub-second-only", "900ms", "900ms"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			info := nativeErrorInfo{Metadata: map[string]string{"quotaResetDelay": tc.raw}}
			if got := info.reset(); got != tc.want {
				t.Fatalf("reset(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
	info := nativeErrorInfo{Metadata: map[string]string{"quotaResetTimeStamp": "2026-11-17T08:18:06Z"}}
	if got := info.reset(); got != "2026-11-17T08:18:06Z" {
		t.Fatalf("timestamp fallback = %q", got)
	}
	if got := (nativeErrorInfo{}).reset(); got != "" {
		t.Fatalf("empty metadata invented %q", got)
	}
}

// The classifier ignores a record whose window is not this turn's own user input.
func TestNativeTrajectoryQuotaResetBounds(t *testing.T) {
	trajectory := liveQuotaTrajectory("fixture-conversation",
		persistedQuotaRecord(429, quotaErrorInfo("QUOTA_EXHAUSTED", "gemini-3.8-flash-high", "1h24m30s", "2026-11-17T08:18:06Z")))
	var parsed nativeTrajectory
	if err := json.Unmarshal([]byte(trajectory), &parsed); err != nil {
		t.Fatal(err)
	}
	if reset, ok := parsed.quotaReset(streamTurnEvidence{conversationID: "fixture-conversation", start: 0, last: 1}); !ok || reset != "1h24m30s" {
		t.Fatalf("own turn not classified: %q, %v", reset, ok)
	}
	for _, evidence := range []streamTurnEvidence{
		{conversationID: "other", start: 0, last: 1},
		{conversationID: "fixture-conversation", start: 1, last: 1},
		{conversationID: "fixture-conversation", start: 0, last: 5},
	} {
		if reset, ok := parsed.quotaReset(evidence); ok {
			t.Fatalf("out-of-window evidence classified: %+v => %q", evidence, reset)
		}
	}
}
