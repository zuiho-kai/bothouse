package core

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// captureProbeLog redirects the default logger at info level for one test.
func captureProbeLog(t *testing.T) (*bytes.Buffer, func()) {
	t.Helper()
	prev := slog.Default()
	buf := &bytes.Buffer{}
	slog.SetDefault(slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	return buf, func() { slog.SetDefault(prev) }
}

// probeLogLine returns the quota auto-probe log line containing msg, or "".
func probeLogLine(buf *bytes.Buffer, msg string) string {
	for _, line := range strings.Split(buf.String(), "\n") {
		if strings.Contains(line, "quota auto-probe") && strings.Contains(line, msg) {
			return line
		}
	}
	return ""
}

// #190: ProbeStatus was written four times and read nowhere, so nobody could tell
// from a log or a panel whether the quota probe had measured anything yet. The
// probe's own log lines now carry the recorded status — one visible consumer, no
// new feature.
func TestQuotaProbeLogCarriesRecordedStatus(t *testing.T) {
	t.Run("Unknown", func(t *testing.T) {
		buf, restore := captureProbeLog(t)
		defer restore()
		e := setupQuotaTestEngine(t)
		now := time.Now()
		e.quotaState.Until = now.Add(-time.Minute)
		e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
			return false, 0, errors.New("usage panel timed out")
		}

		e.quotaTick(now)

		if e.quotaState.ProbeStatus != "unknown" {
			t.Fatalf("probe status = %q, want unknown", e.quotaState.ProbeStatus)
		}
		line := probeLogLine(buf, "usage unknown")
		if line == "" {
			t.Fatalf("no probe log line: %s", buf.String())
		}
		if !strings.Contains(line, `"probe_status":"unknown"`) {
			t.Fatalf("probe log does not show the recorded status: %s", line)
		}
	})

	t.Run("Available", func(t *testing.T) {
		buf, restore := captureProbeLog(t)
		defer restore()
		e := setupQuotaTestEngine(t)
		now := time.Now()
		e.quotaState.Until = now.Add(-time.Minute)
		e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) { return true, 0, nil }

		e.quotaTick(now)

		if e.quotaState.ProbeStatus != "available" {
			t.Fatalf("probe status = %q, want available", e.quotaState.ProbeStatus)
		}
		line := probeLogLine(buf, "restored")
		if line == "" {
			t.Fatalf("no probe log line: %s", buf.String())
		}
		if !strings.Contains(line, `"probe_status":"available"`) {
			t.Fatalf("probe log does not show the recorded status: %s", line)
		}
	})
}
