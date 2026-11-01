package core

import (
	"testing"
	"time"
)

// Source: C酱's independent PR824 review reproduced auth failure changing a
// cooled account to unknown. Admission must not treat that as new allowance.
func TestQuotaUnknownIdentityKeepsProviderCooldown(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	until := time.Now().Add(time.Hour).Truncate(time.Second)
	known := e.admissionQuotaScope(a, "")
	e.recordQuotaFor(known, until, "")
	a.account = "unknown"
	unknown := e.admissionQuotaScope(a, "")
	if got := e.quotaCoolingFor(unknown); !got.Equal(until) {
		t.Fatalf("auth query failure admitted a cooled account: got %v, want %v", got, until)
	}
	restarted := NewEngine("restart", a, nil, "", LangEnglish)
	restarted.dataDir = e.dataDir
	t.Cleanup(restarted.cancel)
	if got := restarted.quotaCoolingFor(unknown); !got.Equal(until) {
		t.Fatalf("restart lost the unresolved account guard: %v", got)
	}
	a.account = "verified-other-account"
	if got := e.quotaCoolingFor(e.admissionQuotaScope(a, "")); !got.IsZero() {
		t.Fatal("a known independent account inherited the unresolved guard")
	}
	unknown.Provider = "independent-provider"
	if got := e.quotaCoolingFor(unknown); !got.IsZero() {
		t.Fatal("unknown identity inherited another provider's cooldown")
	}
}

func TestQuotaUnknownIdentityGuardKeepsLongestDeadline(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	until := time.Now().Add(time.Hour).Truncate(time.Second)
	first := e.admissionQuotaScope(a, "")
	e.recordQuotaFor(first, until, "")
	a.account = "second-account"
	e.recordQuotaFor(e.admissionQuotaScope(a, ""), until.Add(-time.Minute), "")
	a.account = "unknown"
	if got := e.quotaCoolingFor(e.admissionQuotaScope(a, "")); !got.Equal(until) {
		t.Fatalf("a shorter cooldown replaced the provider guard: %v", got)
	}
}
