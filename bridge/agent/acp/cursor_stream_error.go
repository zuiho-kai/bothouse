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
// login/plan notices as fixed sentences. A valid reply preceding the marker is
// returned as prefix so it is not discarded.
func splitCursorStreamError(text string) (prefix, detail string) {
	if i := strings.Index(text, "\n\nError: "); i >= 0 {
		detail = strings.TrimSpace(text[i+2:])
		return text[:i], strings.TrimPrefix(detail, "Error: ")
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
