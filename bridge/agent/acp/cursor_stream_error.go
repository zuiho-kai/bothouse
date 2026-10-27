package acp

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// backendUsageReporter is the slice of core.ModelUsageReporter the ACP
// session needs to classify a streamed Cursor error. Keeping it narrow lets
// tests supply a stub without constructing a full Agent.
type backendUsageReporter interface {
	GetUsageForModel(ctx context.Context, model string) (*core.UsageReport, error)
}

const cursorBackendName = "Cursor"

// splitCursorStreamError recognizes the error text Cursor's ACP server streams
// as an ordinary assistant message before returning stopReason end_turn.
// Cursor prefixes thrown errors with two newlines ("\n\nError: ...") and writes
// login/plan notices as fixed sentences. Only a marker that is the last line
// of an otherwise empty answer counts: a marker followed by more content, or
// preceded by a normal reply, is a log line quoted by that answer, not a fatal
// stream error. Such text is returned unchanged so nothing is truncated.
func splitCursorStreamError(text string) (prefix, detail string) {
	if i := strings.LastIndex(text, "\n\nError: "); i >= 0 {
		tail := strings.TrimSpace(text[i+2:])
		if !strings.Contains(tail, "\n") && strings.TrimSpace(text[:i]) == "" {
			return "", strings.TrimPrefix(tail, "Error: ")
		}
	}
	switch body := strings.TrimSpace(text); body {
	case "Please sign in to continue",
		"Upgrade your plan to continue",
		"Add a payment method to continue",
		"Check your settings to continue":
		return "", body
	}
	return text, ""
}

// holdTrailingStreamError buffers a possible Cursor backend error until the
// prompt response arrives. Chunks are joined first so an error split across
// chunks is still recognized; text that follows the marker with a newline
// proves it was quoted from a log. It returns the text safe to publish now.
// Caller holds outputMu.
func (s *acpSession) holdTrailingStreamError(text string) string {
	text = s.streamErrCandidate + text
	prefix, detail := splitCursorStreamError(text)
	if detail == "" {
		s.streamErrCandidate = ""
		return text
	}
	s.streamErrCandidate = text[len(prefix):]
	return prefix
}

// backendErrorForStream turns Cursor's opaque streamed text into a typed
// failure. When the account quota is measurable, a limit-reached account is
// reported as quota with its reset time; otherwise the text stays an internal
// backend error. Login notices do not need a quota request.
func (s *acpSession) backendErrorForStream(detail string) *core.BackendUnavailableError {
	backend := &core.BackendUnavailableError{
		Provider:    cursorBackendName,
		Kind:        core.BackendErrorInternal,
		Detail:      detail,
		UsedPercent: -1,
	}
	if strings.Contains(detail, "Please sign in") || strings.Contains(detail, "[unauthenticated]") {
		backend.Kind = core.BackendErrorAuth
		return backend
	}
	if s.usageReporter != nil {
		ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
		defer cancel()
		if report, err := s.usageReporter.GetUsageForModel(ctx, s.quotaModel); err == nil {
			used, limited, resetAfter, resetAt := cursorQuotaState(report)
			backend.UsedPercent = used
			if limited {
				backend.Kind = core.BackendErrorQuota
				backend.ResetAfter, backend.ResetAt = resetAfter, resetAt
				slog.Warn("acp: cursor backend error maps to exhausted quota",
					"detail", detail, "used_percent", used, "reset_after", resetAfter)
				return backend
			}
		}
	}
	if strings.Contains(detail, "Upgrade your plan") || strings.Contains(detail, "Add a payment method") {
		backend.Kind = core.BackendErrorPlan
	}
	slog.Warn("acp: cursor backend error streamed as text",
		"detail", detail, "kind", backend.Kind, "used_percent", backend.UsedPercent)
	return backend
}

// cursorQuotaState returns the highest used percentage across the report's
// windows and, when a bucket is exhausted, that window's reset time.
func cursorQuotaState(report *core.UsageReport) (used int, limited bool, resetAfter time.Duration, resetAt time.Time) {
	used = -1
	if report == nil {
		return used, false, 0, time.Time{}
	}
	for _, bucket := range report.Buckets {
		for _, window := range bucket.Windows {
			if window.UsedPercent > used {
				used = window.UsedPercent
			}
			if limited || (!bucket.LimitReached && window.UsedPercent < 100) {
				continue
			}
			limited = true
			used = window.UsedPercent
			resetAfter = time.Duration(window.ResetAfterSeconds) * time.Second
			if window.ResetAtUnix > 0 {
				resetAt = time.Unix(window.ResetAtUnix, 0)
			}
		}
	}
	return used, limited, resetAfter, resetAt
}
