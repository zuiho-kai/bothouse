package antigravity

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func review71Session(t *testing.T, handler http.HandlerFunc) *streamSession {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	base, err := newAntigravitySession(context.Background(), "echo", nil, t.TempDir(), "", "plan", "fixture-conversation", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Close() })
	return &streamSession{antigravitySession: base,
		quota: &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"},
		turn:  streamTurnEvidence{conversationID: "fixture-conversation", start: 2, last: 4, seen: true, finalResponse: true}}
}

func review71ErrorEvent() agyStreamEvent {
	var ev agyStreamEvent
	ev.Result.Status, ev.Result.Response = "ERROR", "CONEST_PROBE_OK"
	ev.Result.Error, ev.Result.ConversationID = "new command failure", "fixture-conversation"
	return ev
}

func TestReview71_CommandExitFailureMustRemainFailure(t *testing.T) {
	trajectory := strings.Replace(recoveredTrajectory,
		"\"type\":\"CORTEX_STEP_TYPE_SYSTEM_MESSAGE\",\"status\":\"CORTEX_STEP_STATUS_DONE\"",
		"\"type\":\"CORTEX_STEP_TYPE_RUN_COMMAND\",\"status\":\"CORTEX_STEP_STATUS_DONE\",\"runCommand\":{\"exitCode\":1}", 1)
	s := review71Session(t, func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, trajectory) })
	if success, err := s.verifyFailedTurn(review71ErrorEvent()); success || err == nil {
		t.Fatalf("command exitCode=1 with CLI ERROR was promoted: success=%v err=%v", success, err)
	}
}

func TestReview71_QuotaDuringRetryExceedsTenSeconds(t *testing.T) {
	firstRead := make(chan struct{})
	quotaDone := make(chan struct{})
	s := review71Session(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/RetrieveUserQuotaSummary") {
			<-r.Context().Done()
			return
		}
		time.Sleep(2 * time.Second)
		io.WriteString(w, strings.ReplaceAll(recoveredTrajectory, "CASCADE_RUN_STATUS_IDLE", "CASCADE_RUN_STATUS_RUNNING"))
		close(firstRead)
	})
	go func() {
		<-firstRead
		time.Sleep(100 * time.Millisecond)
		_, _ = s.quota.get(context.Background(), "gemini-test")
		close(quotaDone)
	}()
	defer func() { <-quotaDone }()
	start := time.Now()
	success, err := s.verifyFailedTurn(review71ErrorEvent())
	elapsed := time.Since(start)
	if success || err == nil {
		t.Fatal("must retain failure")
	}
	if elapsed > 10500*time.Millisecond {
		t.Fatalf("concurrent quota lookup exceeded 10s verification budget: %s", elapsed)
	}
}
