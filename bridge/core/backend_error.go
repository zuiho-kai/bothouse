package core

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// BackendErrorKind classifies why an agent backend could not serve a turn.
// It answers the dispatcher's "was it quota, login, or a crash?" question
// without exposing internal stream names as the whole explanation.
type BackendErrorKind string

const (
	// BackendErrorQuota means the provider account has no usable quota left.
	BackendErrorQuota BackendErrorKind = "quota"
	// BackendErrorPlan means the plan or payment method cannot serve the turn.
	BackendErrorPlan BackendErrorKind = "plan"
	// BackendErrorAuth means the provider login is missing or rejected.
	BackendErrorAuth BackendErrorKind = "auth"
	// BackendErrorInternal covers transient provider/stream failures.
	BackendErrorInternal BackendErrorKind = "internal"
)

// BackendUnavailableError reports a turn that failed because the agent's
// backend was unavailable (quota exhausted, login expired, plan/payment
// problem, or an internal stream error). It carries enough structure for the
// task relay to fail the member row with the same reason instead of leaving
// it queued, and for chat replies to show a localized explanation.
type BackendUnavailableError struct {
	Provider    string // display name, e.g. "Cursor"
	Kind        BackendErrorKind
	Detail      string // raw backend text, e.g. "v: WritableIterable is closed"
	UsedPercent int    // quota used percentage; -1 when unknown
	ResetAfter  time.Duration
	ResetAt     time.Time
}

// Error implements error with a log/CLI-friendly English rendering. User
// facing chat and task-card text goes through BackendUnavailableText so it
// follows the project language.
func (e *BackendUnavailableError) Error() string {
	if e == nil {
		return "backend unavailable"
	}
	provider := strings.TrimSpace(e.Provider)
	if provider == "" {
		provider = "agent"
	}
	switch e.Kind {
	case BackendErrorQuota:
		msg := provider + " quota exhausted"
		if e.UsedPercent >= 0 {
			msg += fmt.Sprintf(" (%d%% used)", e.UsedPercent)
		}
		switch {
		case e.ResetAfter > 0:
			msg += "; resets in " + e.ResetAfter.Round(time.Minute).String()
		case !e.ResetAt.IsZero():
			msg += "; resets at " + e.ResetAt.Local().Format("2006-01-02 15:04")
		}
		return msg
	case BackendErrorPlan:
		return fmt.Sprintf("%s plan or payment method unavailable: %s", provider, detailOrUnknown(e.Detail))
	case BackendErrorAuth:
		return provider + " login required"
	default:
		return fmt.Sprintf("%s backend unavailable: %s", provider, detailOrUnknown(e.Detail))
	}
}

// BackendUnavailableText renders err for users when it is a backend failure.
// It returns ok=false for ordinary errors so callers keep their generic path.
func BackendUnavailableText(err error, lang Language) (string, bool) {
	var backend *BackendUnavailableError
	if !errors.As(err, &backend) {
		return "", false
	}
	provider := strings.TrimSpace(backend.Provider)
	if provider == "" {
		provider = "agent"
	}
	i18n := NewI18n(lang)
	switch backend.Kind {
	case BackendErrorQuota:
		if reset := backendResetText(backend, lang); reset != "" {
			return i18n.Tf(MsgQuotaExhaustedResets, provider, reset), true
		}
		return i18n.Tf(MsgQuotaExhausted, provider), true
	case BackendErrorPlan:
		return i18n.Tf(MsgBackendPlanUnavailable, provider, detailOrUnknown(backend.Detail)), true
	case BackendErrorAuth:
		return i18n.Tf(MsgBackendAuthRequired, provider), true
	default:
		msg := i18n.Tf(MsgBackendUnavailable, provider, detailOrUnknown(backend.Detail))
		if backend.UsedPercent >= 0 && backend.UsedPercent < 100 {
			msg += i18n.Tf(MsgBackendQuotaRemaining, 100-backend.UsedPercent)
		}
		return msg, true
	}
}

// backendResetText prefers the provider-reported countdown; an absolute
// reset timestamp is the fallback when the API only exposes the cycle end.
func backendResetText(err *BackendUnavailableError, lang Language) string {
	if err.ResetAfter > 0 {
		return formatDurationI18n(err.ResetAfter, lang)
	}
	if !err.ResetAt.IsZero() {
		return err.ResetAt.Local().Format("01-02 15:04")
	}
	return ""
}

func detailOrUnknown(detail string) string {
	if trimmed := strings.TrimSpace(detail); trimmed != "" {
		return trimmed
	}
	return "unknown"
}
