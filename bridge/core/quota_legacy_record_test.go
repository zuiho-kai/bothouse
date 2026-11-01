package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeLegacyQuotaRecord drops a sanitized copy of a role-level record - the kind
// left before scopes existed - into the engine's data dir. No real address,
// organization or token is stored: only the shape matters here.
func writeLegacyQuotaRecord(t *testing.T, e *Engine, until time.Time) {
	t.Helper()
	st := map[string]any{
		"legacy_until":  until.Format(time.RFC3339Nano),
		"cooling_until": until.Format(time.RFC3339Nano),
	}
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(e.quotaPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(e.quotaPath(), b, 0o600); err != nil {
		t.Fatal(err)
	}
	e.loadQuotaCooling()
}

func fullQuotaReport() *UsageReport {
	return &UsageReport{Buckets: []UsageBucket{{
		Windows: []UsageWindow{{UsedPercent: 12}},
	}}}
}

// TestQuotaLegacyRecordReleasesAccountWithMeasuredQuota is the sanitized-copy
// check the review asked for: an old role-level record must not keep blocking an
// account that has a measured, unused allowance.
func TestQuotaLegacyRecordReleasesAccountWithMeasuredQuota(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	writeLegacyQuotaRecord(t, e, time.Now().Add(time.Hour))

	account, group := a.QuotaScope("A")
	if until := e.quotaCoolingFor(quotaScope{Provider: "claudecode", Account: account, Group: group}); until.IsZero() {
		t.Fatal("the legacy record did not block before any measurement")
	}

	a.reports = map[string]*UsageReport{"A": fullQuotaReport()}
	scope := e.admissionQuotaScope(a, "")
	if scope.Account != "test-account" {
		t.Fatalf("admission produced account %q", scope.Account)
	}
	if until := e.quotaCoolingFor(scope); !until.IsZero() {
		t.Fatalf("a measured, unused allowance stayed blocked until %s", until)
	}
}

// TestQuotaLegacyRecordHoldsWhenQuotaQueryFails keeps the failure conservative:
// a failed measurement must not release the old record.
func TestQuotaLegacyRecordHoldsWhenQuotaQueryFails(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	writeLegacyQuotaRecord(t, e, time.Now().Add(time.Hour))

	a.probeErr = os.ErrDeadlineExceeded
	if until := e.quotaCoolingFor(e.admissionQuotaScope(a, "")); until.IsZero() {
		t.Fatal("a failed quota query released the legacy record")
	}
}

// TestQuotaLegacyRecordReturnsWhenSwitchingBack keeps the old account's limit for
// the account that actually ran out.
func TestQuotaLegacyRecordReturnsWhenSwitchingBack(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	writeLegacyQuotaRecord(t, e, time.Now().Add(time.Hour))

	a.reports = map[string]*UsageReport{"A": fullQuotaReport()}
	released := e.admissionQuotaScope(a, "")
	if until := e.quotaCoolingFor(released); !until.IsZero() {
		t.Fatal("the first account was not released after a measured report")
	}

	// A different account never got that measurement, so the record still holds.
	other := quotaScope{Provider: "claudecode", Account: "acct:other", Group: "account"}
	if until := e.quotaCoolingFor(other); until.IsZero() {
		t.Fatal("an unmeasured account was released by another account's report")
	}
}
