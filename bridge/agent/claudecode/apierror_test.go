package claudecode

import (
	"context"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Real CLI output (claude 2.1.x stream-json) when the plan quota is used up.
const usageLimitLine = `{"type":"assistant","message":{"model":"<synthetic>","role":"assistant","content":[{"type":"text","text":"You've hit your session limit · resets 10pm (Asia/Tokyo)"}]},"error":"rate_limit","is_api_error_message":true}`
const usageLimitResult = `{"type":"result","subtype":"success","is_error":true,"result":"You've hit your session limit · resets 10pm (Asia/Tokyo)"}`
const authErrorLine = `{"type":"assistant","message":{"model":"<synthetic>","role":"assistant","content":[{"type":"text","text":"Not logged in · Please run /login"}]},"error":"authentication_failed","is_api_error_message":true}`

func wantQuotaMark(t *testing.T, e core.Event) {
	t.Helper()
	if reset, ok := core.QuotaExhaustedReset(e); !ok || reset != "10pm (Asia/Tokyo)" {
		t.Fatalf("quota mark = %q, %v; event %+v", reset, ok, e)
	}
}

func newAPIErrTestSession(t *testing.T) *claudeSession {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	cs := &claudeSession{events: make(chan core.Event, 8), ctx: ctx}
	cs.sessionID.Store("s")
	old := apiErrorResultGrace
	apiErrorResultGrace = 50 * time.Millisecond
	t.Cleanup(func() { apiErrorResultGrace = old })
	return cs
}

func nextEvent(t *testing.T, cs *claudeSession) (core.Event, bool) {
	t.Helper()
	select {
	case e := <-cs.events:
		return e, true
	case <-time.After(300 * time.Millisecond):
		return core.Event{}, false
	}
}

// Usage limit with no result from the CLI: the fallback must end the turn.
func TestAPIErrorWithoutResultSynthesizesTurnEnd(t *testing.T) {
	cs := newAPIErrTestSession(t)
	cs.handleReadLoopLine(usageLimitLine)
	// No text event: the raw notice must not be streamed as a reply.
	e, ok := nextEvent(t, cs)
	if !ok || e.Type != core.EventResult || !e.Done {
		t.Fatalf("want synthesized done result, got ok=%v %+v", ok, e)
	}
	wantQuotaMark(t, e)
	// The CLI's late result for the same turn is dropped.
	cs.handleReadLoopLine(usageLimitResult)
	if e, ok := nextEvent(t, cs); ok {
		t.Fatalf("late result should be dropped, got %+v", e)
	}
}

// Usage limit followed by the CLI's own result: exactly one turn end.
func TestAPIErrorWithResultEndsTurnOnce(t *testing.T) {
	cs := newAPIErrTestSession(t)
	cs.handleReadLoopLine(usageLimitLine)
	cs.handleReadLoopLine(usageLimitResult)
	e, ok := nextEvent(t, cs)
	if !ok || e.Type != core.EventResult || !e.Done {
		t.Fatalf("want real result, got ok=%v %+v", ok, e)
	}
	wantQuotaMark(t, e)
	if e, ok := nextEvent(t, cs); ok {
		t.Fatalf("fallback fired after real result: %+v", e)
	}
	// The mark belongs to that turn only.
	cs.handleReadLoopLine(`{"type":"result","subtype":"success","result":"ok"}`)
	if e, ok := nextEvent(t, cs); !ok {
		t.Fatal("no result for next turn")
	} else if _, marked := core.QuotaExhaustedReset(e); marked {
		t.Fatalf("quota mark leaked into next turn: %+v", e)
	}
}

// Other API errors keep their text as the reply and carry no quota mark.
func TestNonQuotaAPIErrorKeepsText(t *testing.T) {
	cs := newAPIErrTestSession(t)
	cs.handleReadLoopLine(authErrorLine)
	if e, _ := nextEvent(t, cs); e.Type != core.EventText || e.Content != "Not logged in · Please run /login" {
		t.Fatalf("first event = %+v, want text", e)
	}
	e, ok := nextEvent(t, cs)
	if !ok || e.Type != core.EventResult {
		t.Fatalf("want synthesized result, got ok=%v %+v", ok, e)
	}
	if _, marked := core.QuotaExhaustedReset(e); marked {
		t.Fatalf("non-quota error marked as quota: %+v", e)
	}
}

func TestClaudeQuotaExhausted(t *testing.T) {
	for _, tc := range []struct {
		kind, text, reset string
		ok                bool
	}{
		{"rate_limit", "You've hit your session limit · resets 10pm (Asia/Tokyo)", "10pm (Asia/Tokyo)", true},
		{"rate_limit", "You've hit your weekly limit · resets Oct 30, 9am (Asia/Tokyo)", "Oct 30, 9am (Asia/Tokyo)", true},
		{"rate_limit", "API Error: Request rejected (429) · usage limit", "", true},
		{"rate_limit", "API Error: Request rejected (429) · slow down", "", false},
		{"authentication_failed", "You've hit your session limit", "", false},
	} {
		reset, ok := claudeQuotaExhausted(tc.kind, tc.text)
		if ok != tc.ok || reset != tc.reset {
			t.Errorf("claudeQuotaExhausted(%q, %q) = %q, %v; want %q, %v", tc.kind, tc.text, reset, ok, tc.reset, tc.ok)
		}
	}
}

// The session closes before the fallback fires: no send on the closed channel.
func TestAPIErrorFallbackAfterCloseDoesNotPanic(t *testing.T) {
	cs := newAPIErrTestSession(t)
	cs.handleReadLoopLine(usageLimitLine)
	cs.apiErrMu.Lock()
	cs.apiErrClosed = true
	if cs.apiErrTimer != nil {
		cs.apiErrTimer.Stop()
		cs.apiErrTimer = nil
	}
	cs.apiErrMu.Unlock()
	close(cs.events)
	time.Sleep(2 * apiErrorResultGrace)
}
