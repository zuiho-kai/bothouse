package core

import (
	"context"
	"testing"
	"time"
)

// #771/#780: display names are deliberately unrelated to pool identifiers.
func TestQuotaModelWindowsConsumers(t *testing.T) {
	for _, entry := range []string{"result", "probe", "legacy-admission"} {
		for _, tc := range []struct{ name, group, want string }{
			{"other model", "pool-b", "available"},
			{"current model", "pool-a", "exhausted"},
			{"all models", "account", "exhausted"},
		} {
			t.Run(entry+"/"+tc.name, func(t *testing.T) {
				e, a := scopedQuotaFixture(t)
				report := &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{
					{Name: "not a model name", QuotaGroup: "account", UsedPercent: 10},
					{Name: "opaque display name", QuotaGroup: tc.group, UsedPercent: 100, ResetAtUnix: time.Now().Add(time.Hour).Unix()},
				}}}}
				a.reports = map[string]*UsageReport{"A": report}
				scope := e.quotaScopeFor(a, "A")
				switch entry {
				case "result":
					e.observeQuotaUsageAfterResult(report, "discord:test", scope, true)
				case "probe":
					usable, _, err := e.probeQuota(context.Background())
					if err != nil || usable != (tc.want == "available") {
						t.Fatalf("probe: usable=%v err=%v", usable, err)
					}
					return
				case "legacy-admission":
					e.quotaUntil = time.Now().Add(time.Hour)
					scope = e.admissionQuotaScope(a, "discord:test")
				}
				e.waitQuotaUpdates()
				if _, got := e.quotaAvailabilityFor(scope, time.Now()); got != tc.want {
					t.Fatalf("got %s want %s", got, tc.want)
				}
				if entry == "result" && tc.group == "account" && e.quotaCoolingFor(e.quotaScopeFor(a, "B")).IsZero() {
					t.Fatal("account-wide window did not block the other model")
				}
				if entry == "result" && tc.group == "pool-a" && !e.quotaCoolingFor(e.quotaScopeFor(a, "B")).IsZero() {
					t.Fatal("model-only window blocked the other model")
				}
			})
		}
	}
}

func TestQuotaModelWindowsUnrelatedOnlyIsUnknown(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	report := &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{QuotaGroup: "pool-b", UsedPercent: 0}}}}}
	a.reports = map[string]*UsageReport{"A": report}
	scope := e.quotaScopeFor(a, "A")
	e.observeQuotaUsageFor(report, "discord:test", scope)
	e.waitQuotaUpdates()
	if _, status := e.quotaAvailabilityFor(scope, time.Now()); status != "unknown" {
		t.Fatal(status)
	}
	if usable, _, err := e.probeQuota(context.Background()); usable || err == nil {
		t.Fatalf("unrelated report proved availability: %v %v", usable, err)
	}
}

func TestQuotaModelWindowsUnresolvedModelKeepsLimits(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	a.groups["A"] = "account"
	report := &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{
		{QuotaGroup: "account", UsedPercent: 10},
		{QuotaGroup: "pool-a", UsedPercent: 100},
	}}}}
	e.observeQuotaUsageFor(report, "discord:test", e.quotaScopeFor(a, "A"))
	e.waitQuotaUpdates()
	if _, status := e.quotaAvailabilityFor(e.quotaScopeFor(a, "A"), time.Now()); status != "exhausted" {
		t.Fatal("an unresolved model discarded an applicable limit:", status)
	}
}

func TestQuotaModelWindowsAccountRecovery(t *testing.T) {
	for _, via := range []string{"answer", "probe", "unknown probe"} {
		t.Run(via, func(t *testing.T) {
			e, a := scopedQuotaFixture(t)
			e.SetRelayManager(NewRelayManager(e.dataDir))
			scope := e.quotaScopeFor(a, "A")
			if via == "answer" {
				e.recordQuotaFor(scope.accountScope(), time.Now().Add(time.Hour), "")
				e.recoverQuotaFor(scope)
			} else {
				expired := time.Now().Add(-time.Minute)
				quotaDomainsMu.Lock()
				e.saveDomainLocked(scope.accountScope().key(), expired)
				quotaDomainsMu.Unlock()
				e.quotaState = quotaCoolingState{Scope: scope.accountScope().key(), Until: expired}
				a.reports = map[string]*UsageReport{}
				if via == "probe" {
					a.reports["A"] = &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{QuotaGroup: "account", UsedPercent: 10}}}}}
				}
			}
			e.waitQuotaUpdates()
			e.quotaTick(time.Now())
			want := "available"
			if via == "unknown probe" {
				want = "unknown"
			}
			if _, status := e.quotaAvailabilityFor(scope, time.Now()); status != want {
				t.Fatalf("selected model status=%s want=%s", status, want)
			}
			if e.quotaState.ProbeScope != scope.key() {
				t.Fatal("probe evidence was attributed to the account parent instead of the selected model")
			}
		})
	}
}
