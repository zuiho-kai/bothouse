package antigravity

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// #873: agy's result line only carries a status (ERROR), so a spent quota
// reached the chat as the generic "stream turn failed (ERROR)". The provider
// does record why it refused the turn — in the native trajectory step
// CORTEX_STEP_TYPE_ERROR_MESSAGE, whose errorMessage.error holds the 429 and the
// google.rpc.ErrorInfo that says QUOTA_EXHAUSTED and names the reset. This file
// turns that record into a typed failure fact. Only the machine-readable fields
// are read: provider prose (shortError/fullError/message) can carry credentials
// or tool output and is never read, logged or relayed.

// quotaFailure is a failed turn that the provider's own record proves ran out of
// quota. It keeps the safe turn diagnostic and adds only the validated reset
// time the provider gave, so the caller can mark the event
// (core.WithQuotaExhausted) without any provider text.
type quotaFailure struct {
	base  error  // safe generic, command or stream diagnostic
	reset string // countdown or reset timestamp the provider published; "" = none
}

func (f *quotaFailure) Error() string { return f.base.Error() }
func (f *quotaFailure) Unwrap() error { return f.base }

// quotaFailureOf reports the reset time when err is a turn the provider refused
// for a spent quota.
func quotaFailureOf(err error) (string, bool) {
	var f *quotaFailure
	if errors.As(err, &f) {
		return f.reset, true
	}
	return "", false
}

// nativeErrorRecord is one errorMessage.error of a CORTEX_STEP_TYPE_ERROR_MESSAGE
// step. The typed fields decide the classification; the prose fields only keep
// the record's shape and are never read.
type nativeErrorRecord struct {
	ErrorCode      int      `json:"errorCode"`
	Details        string   `json:"details"`         // provider error document; live RPC only
	RPCErrorDetail []string `json:"rpcErrorDetails"` // google.rpc.* entries; live RPC and persisted steps
	ShortError     string   `json:"shortError"`
}

// nativeErrorInfo is the part of google.rpc.ErrorInfo the bridge classifies.
// The keys are the provider's own JSON names.
type nativeErrorInfo struct {
	Type     string            `json:"@type"`
	Reason   string            `json:"reason"`
	Metadata map[string]string `json:"metadata"`
}

// providerQuotaExhausted is the provider's typed reason for a spent quota. Any
// other reason (RATE_LIMIT_EXCEEDED and friends) is not a spent quota and keeps
// the generic failure and the normal retry rules.
const providerQuotaExhausted = "QUOTA_EXHAUSTED"

// providerErrorInfoType is the google.rpc.ErrorInfo type URL the provider sends.
const providerErrorInfoType = "google.rpc.ErrorInfo"

// providerStatusTooManyRequests is the provider's own status for this refusal.
// Source: three quota refusals, 2026-11-17 17:53-17:56 (notes/bug-dadoubao-
// stream-20261117.evidence.json) and the live trajectory of 2026-11-18 04:52,
// all errorCode 429.
const providerStatusTooManyRequests = 429

// quotaReset reports whether the provider's own typed refusal says this turn ran
// out of quota, and the reset time it gave. The live RPC and the trajectory agy
// persists carry the same ErrorInfo entries, so one record classifies the turn
// either way.
func (r nativeErrorRecord) quotaReset() (string, bool) {
	// 429 alone is not proof: the provider sends it for rate limits too. Only
	// the typed reason classifies.
	if r.ErrorCode != providerStatusTooManyRequests {
		return "", false
	}
	for _, info := range r.errorInfos() {
		if !strings.HasSuffix(info.Type, providerErrorInfoType) || info.Reason != providerQuotaExhausted {
			continue
		}
		return info.reset(), true
	}
	return "", false
}

// errorInfos collects the google.rpc.* entries of this record. The live RPC
// lists them in rpcErrorDetails; a persisted step carries the same entries
// inside its details document, which repeats the whole provider error.
func (r nativeErrorRecord) errorInfos() []nativeErrorInfo {
	infos := make([]nativeErrorInfo, 0, len(r.RPCErrorDetail)+1) // +1: the details document
	for _, raw := range r.RPCErrorDetail {
		var info nativeErrorInfo
		if json.Unmarshal([]byte(raw), &info) == nil {
			infos = append(infos, info)
		}
	}
	var document struct {
		Error struct {
			Details []nativeErrorInfo `json:"details"`
		} `json:"error"`
	}
	if json.Unmarshal([]byte(r.Details), &document) == nil {
		infos = append(infos, document.Error.Details...)
	}
	return infos
}

// reset renders the reset time as the provider published it. The countdown comes
// first: it is a duration, so the chat text and the cooldown window read it the
// same way (core.quotaResetTime). The absolute timestamp is the fallback when the
// API names only the cycle end; parse it here so raw provider text stays out.
func (i nativeErrorInfo) reset() string {
	if d, err := time.ParseDuration(strings.TrimSpace(i.Metadata["quotaResetDelay"])); err == nil && d > 0 {
		if d >= time.Second {
			// The CLI prints the same countdown truncated to the second ("Resets
			// in 1h24m30s" for 1h24m30.325535089s), so truncate rather than
			// round: the chat line and the CLI's own wording agree.
			d = d.Truncate(time.Second)
		}
		return d.String()
	}
	if stamp, err := time.Parse(time.RFC3339, strings.TrimSpace(i.Metadata["quotaResetTimeStamp"])); err == nil {
		return stamp.UTC().Format(time.RFC3339Nano)
	}
	return ""
}

// The refusal probe reads the native record a few times before giving up. The
// evidence puts the error step a few milliseconds before the result line
// (cli-20261117_175326.log: error at 17:53:35.786648, result at .793329), so the
// first read usually has it; the retries only cover that race. Source: 实测,
// three quota failures of 2026-11-17 17:53-17:56.
const (
	refusalProbeAttempts = 3
	refusalProbeGap      = 250 * time.Millisecond
	refusalProbeTimeout  = 2 * time.Second
)

// quotaRefusal asks the native record why a refused turn ended without an
// answer. This diagnoses a failure that is already certain, so it gets a short
// budget of its own rather than the verification budget: without a typed
// refusal the caller keeps the generic failure it had before.
func (s *streamSession) quotaRefusal(t streamTurnEvidence, resultConversationID string) (string, bool) {
	// Only the turn this result belongs to may be read: same conversation on
	// three sides, and a stream that saw its own user-input boundary.
	if s.quota == nil || !t.seen || t.invalid || t.conversationID == "" ||
		t.conversationID != resultConversationID || t.conversationID != s.CurrentSessionID() {
		return "", false
	}
	ctx, cancel := context.WithTimeout(s.ctx, refusalProbeTimeout)
	defer cancel()
	for i := 0; i < refusalProbeAttempts; i++ {
		if i > 0 {
			select {
			case <-ctx.Done():
				return "", false
			case <-time.After(refusalProbeGap):
			}
		}
		trajectory, err := s.quota.trajectory(ctx, t.conversationID)
		if err != nil || trajectory == nil {
			return "", false
		}
		if reset, ok := trajectory.quotaReset(t); ok {
			return reset, true
		}
		if trajectory.settled(t) {
			return "", false // the record is complete and says nothing about quota
		}
	}
	return "", false
}

// quotaReset reports the reset time when a step of this turn proves the provider
// refused it for a spent quota. Only steps inside the turn are read: an
// errorMessage left by an earlier turn must never be attributed to this one.
func (n *nativeTrajectory) quotaReset(t streamTurnEvidence) (string, bool) {
	steps := n.Trajectory.Steps
	if n.Trajectory.CascadeID != t.conversationID {
		return "", false
	}
	if t.start < 0 || t.last < t.start || t.last >= len(steps) {
		return "", false
	}
	// The window must start at this turn's own user message: that step is the
	// only native proof that the steps after it belong to this turn.
	if steps[t.start].Type != "CORTEX_STEP_TYPE_USER_INPUT" || steps[t.start].Status != "CORTEX_STEP_STATUS_DONE" {
		return "", false
	}
	for _, step := range steps[t.start : t.last+1] {
		if step.ErrorMessage == nil {
			continue
		}
		if reset, ok := step.ErrorMessage.Error.quotaReset(); ok {
			return reset, true
		}
	}
	return "", false
}
