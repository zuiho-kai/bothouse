package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type stubUsageReporter struct {
	report *core.UsageReport
	err    error
	model  string
	calls  int
}

func (s *stubUsageReporter) GetUsageForModel(_ context.Context, model string) (*core.UsageReport, error) {
	s.calls++
	s.model = model
	return s.report, s.err
}

// Cursor's ACP server streams "v: WritableIterable is closed" as assistant
// text and still returns end_turn. The adapter must surface one typed error
// (with the quota reset time) instead of publishing text plus success.
func TestCursorStreamedErrorBecomesTypedBackendError(t *testing.T) {
	s, wResp, rReq := newTestSession(t, nil)
	s.cursorStreamErrors = true
	s.quotaModel = "grok-4.7"
	reporter := &stubUsageReporter{report: &core.UsageReport{Provider: "Cursor", Buckets: []core.UsageBucket{{
		Name:         "API",
		LimitReached: true,
		Windows: []core.UsageWindow{{
			UsedPercent:       100,
			ResetAfterSeconds: 7200,
			ResetAtUnix:       time.Now().Add(2 * time.Hour).Unix(),
		}},
	}}}}
	s.usageReporter = reporter
	servePromptReply(t, rReq, wResp, "\n\nError: v: WritableIterable is closed")

	err := s.Send("hi", "", nil, nil)
	if err == nil {
		t.Fatal("Send succeeded after the backend streamed an error")
	}
	var backend *core.BackendUnavailableError
	if !errors.As(err, &backend) {
		t.Fatalf("Send error is not BackendUnavailableError: %v", err)
	}
	if backend.Kind != core.BackendErrorQuota || backend.UsedPercent != 100 {
		t.Fatalf("backend error = %+v, want quota at 100%%", backend)
	}
	if backend.ResetAfter != 2*time.Hour {
		t.Fatalf("reset = %v, want 2h", backend.ResetAfter)
	}
	if reporter.model != "grok-4.7" || reporter.calls != 1 {
		t.Fatalf("quota lookup = (%q, %d calls), want the configured model once", reporter.model, reporter.calls)
	}

	events := drainEvents(s)
	if len(events) != 1 || events[0].Type != core.EventError {
		t.Fatalf("events = %+v, want exactly one EventError (no text/result)", events)
	}
	if !errors.As(events[0].Error, &backend) {
		t.Fatalf("event error = %v, want typed backend error", events[0].Error)
	}
	msg, ok := core.BackendUnavailableText(err, core.LangChinese)
	if !ok || !strings.Contains(msg, "Cursor 额度已用完") || !strings.Contains(msg, "2小时") {
		t.Fatalf("localized message = %q, ok=%v", msg, ok)
	}
}

// A well-formed reply on a generic ACP backend must keep flowing as text and
// success; the Cursor marker must not rewrite other handlers.
func TestCursorStreamErrorMarkerIgnoredForOtherACP(t *testing.T) {
	s, wResp, rReq := newTestSession(t, nil)
	servePromptReply(t, rReq, wResp, "\n\nError: v: WritableIterable is closed")

	if err := s.Send("hi", "", nil, nil); err != nil {
		t.Fatalf("Send: %v", err)
	}
	events := drainEvents(s)
	var text, result int
	for _, ev := range events {
		switch ev.Type {
		case core.EventText:
			text++
			if !strings.Contains(ev.Content, "WritableIterable is closed") {
				t.Fatalf("text = %q", ev.Content)
			}
		case core.EventResult:
			result++
		case core.EventError:
			t.Fatalf("unexpected error event: %v", ev.Error)
		}
	}
	if text != 1 || result != 1 {
		t.Fatalf("events = %+v, want one text and one result", events)
	}
}

func TestCursorStreamErrorClassification(t *testing.T) {
	report := &core.UsageReport{Buckets: []core.UsageBucket{{
		Name:    "API",
		Windows: []core.UsageWindow{{UsedPercent: 40}},
	}}}
	for _, tc := range []struct {
		name     string
		text     string
		reporter backendUsageReporter
		kind     core.BackendErrorKind
		used     int
	}{
		{"login", "\n\nPlease sign in to continue", nil, core.BackendErrorAuth, -1},
		{"plan", "\n\nUpgrade your plan to continue", nil, core.BackendErrorPlan, -1},
		{"internal with quota left", "\n\nError: v: WritableIterable is closed", &stubUsageReporter{report: report}, core.BackendErrorInternal, 40},
		{"quota unreachable", "\n\nError: v: WritableIterable is closed", &stubUsageReporter{err: errors.New("offline")}, core.BackendErrorInternal, -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &acpSession{ctx: context.Background(), usageReporter: tc.reporter}
			prefix, detail := splitCursorStreamError(tc.text)
			if prefix != "" || detail == "" {
				t.Fatalf("split = (%q, %q)", prefix, detail)
			}
			backend := s.backendErrorForStream(detail)
			if backend.Kind != tc.kind || backend.UsedPercent != tc.used {
				t.Fatalf("backend = %+v, want kind=%s used=%d", backend, tc.kind, tc.used)
			}
		})
	}
}

func TestSplitCursorStreamErrorKeepsNormalText(t *testing.T) {
	for _, text := range []string{
		"hello",
		"The error: retry later",
		"Done.\n\nErrors: none",
		// A normal answer quoting a log line must survive byte-for-byte.
		"运行结果：\n\nError: file not found",
		"运行结果：\n\nError: file not found\n\n重试后成功。",
	} {
		prefix, detail := splitCursorStreamError(text)
		if prefix != text || detail != "" {
			t.Fatalf("split(%q) = (%q, %q), want unchanged", text, prefix, detail)
		}
	}
}

// A normal answer that quotes a log line beginning with Cursor's marker is not
// a backend failure: the turn must succeed and keep the quoted text intact.
func TestCursorStreamErrorQuotedInAnswerStaysSuccessful(t *testing.T) {
	s, wResp, rReq := newTestSession(t, nil)
	s.cursorStreamErrors = true
	const quoted = "运行结果：\n\nError: file not found"
	servePromptReply(t, rReq, wResp, quoted)

	if err := s.Send("hi", "", nil, nil); err != nil {
		t.Fatalf("Send: %v", err)
	}
	var text strings.Builder
	var results int
	for _, ev := range drainEvents(s) {
		switch ev.Type {
		case core.EventText:
			text.WriteString(ev.Content)
		case core.EventResult:
			results++
		case core.EventError:
			t.Fatalf("unexpected error event: %v", ev.Error)
		}
	}
	if got := text.String(); got != quoted {
		t.Fatalf("text = %q, want %q", got, quoted)
	}
	if results != 1 {
		t.Fatalf("result events = %d, want 1", results)
	}
}

// A genuine backend error may arrive split across ACP chunks; joining the
// chunks must still recognize it and surface one typed error.
func TestCursorStreamedErrorSplitAcrossChunksStillFails(t *testing.T) {
	s, wResp, rReq := newTestSession(t, nil)
	s.cursorStreamErrors = true
	servePromptReply(t, rReq, wResp, "\n\nError: v: WritableIterable ", "is closed")

	err := s.Send("hi", "", nil, nil)
	if err == nil {
		t.Fatal("Send succeeded after a chunked backend error")
	}
	var backend *core.BackendUnavailableError
	if !errors.As(err, &backend) {
		t.Fatalf("Send error is not BackendUnavailableError: %v", err)
	}
	events := drainEvents(s)
	if len(events) != 1 || events[0].Type != core.EventError {
		t.Fatalf("events = %+v, want exactly one EventError", events)
	}
}

// Text after the marker in a later chunk also proves the marker was quoted.
func TestCursorStreamErrorMarkerBeforeLaterTextStaysSuccessful(t *testing.T) {
	s, wResp, rReq := newTestSession(t, nil)
	s.cursorStreamErrors = true
	const first = "运行结果：\n\nError: file not found"
	const second = "\n\n重试后成功。"
	servePromptReply(t, rReq, wResp, first, second)

	if err := s.Send("hi", "", nil, nil); err != nil {
		t.Fatalf("Send: %v", err)
	}
	var text strings.Builder
	var results int
	for _, ev := range drainEvents(s) {
		switch ev.Type {
		case core.EventText:
			text.WriteString(ev.Content)
		case core.EventResult:
			results++
		case core.EventError:
			t.Fatalf("unexpected error event: %v", ev.Error)
		}
	}
	if got, want := text.String(), first+second; got != want {
		t.Fatalf("text = %q, want %q", got, want)
	}
	if results != 1 {
		t.Fatalf("result events = %d, want 1", results)
	}
}

func servePromptReply(t *testing.T, rReq *io.PipeReader, wResp *io.PipeWriter, chunks ...string) {
	t.Helper()
	go func() {
		scan := bufio.NewScanner(rReq)
		enc := json.NewEncoder(wResp)
		for scan.Scan() {
			var req inputRPCRequest
			if json.Unmarshal(scan.Bytes(), &req) != nil || req.Method != "session/prompt" {
				continue
			}
			for _, text := range chunks {
				_ = enc.Encode(inputUpdate("test-session-id", text))
			}
			_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"stopReason": "end_turn"}})
			return
		}
	}()
}

func drainEvents(s *acpSession) []core.Event {
	var out []core.Event
	for {
		select {
		case ev := <-s.events:
			out = append(out, ev)
		default:
			return out
		}
	}
}
