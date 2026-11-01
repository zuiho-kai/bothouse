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

// TestQuotaAccountSwitchFullChain walks the real entry points instead of hand
// building scopes: the old account runs out through a recorded turn, the user
// swaps accounts and gets a measured usable allowance, then swaps back.
func TestQuotaAccountSwitchFullChain(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	a.reports = map[string]*UsageReport{"A": fullQuotaReport()}

	// 1. The account in use runs out; the turn records it against its own scope.
	oldScope := e.admissionQuotaScope(a, "")
	if oldScope.Account != "test-account" {
		t.Fatalf("first admission produced account %q", oldScope.Account)
	}
	e.recordQuotaFor(oldScope, time.Now().Add(time.Hour), "")
	if e.quotaCoolingFor(oldScope).IsZero() {
		t.Fatal("the exhausted account was not in cooldown")
	}

	// 2. The user swaps accounts; the new one is not blocked by the old record.
	a.account = "acct-new-account"
	newScope := e.admissionQuotaScope(a, "")
	if newScope.Account != "acct-new-account" {
		t.Fatalf("admission after the swap produced account %q", newScope.Account)
	}
	if until := e.quotaCoolingFor(newScope); !until.IsZero() {
		t.Fatalf("the previous account's cooldown blocked the new account until %s", until)
	}

	// 3. The new account has a measured, unused allowance: it runs normally.
	if until := e.quotaCoolingFor(e.admissionQuotaScope(a, "")); !until.IsZero() {
		t.Fatal("the measured new account was still cooled down")
	}

	// 4. Swapping back must still find the exhausted account's limit.
	a.account = "test-account"
	backScope := e.admissionQuotaScope(a, "")
	if backScope.Account != "test-account" {
		t.Fatalf("admission after switching back produced account %q", backScope.Account)
	}
	if e.quotaCoolingFor(backScope).IsZero() {
		t.Fatal("switching back to the exhausted account lost its cooldown")
	}
}
