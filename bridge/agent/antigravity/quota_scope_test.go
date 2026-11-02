package antigravity

import (
	"github.com/chenhg5/cc-connect/core"
	"testing"
	"time"
)

func TestQuotaScopeUsesSharedGroups(t *testing.T) {
	a := &Agent{}
	a.cloudQuota.homeDir = t.TempDir()
	_, flash := a.QuotaScope("gemini-3.8-flash-high")
	_, pro := a.QuotaScope("gemini-3.8-pro-high")
	_, claude := a.QuotaScope("claude-sonnet-4-6")
	_, gpt := a.QuotaScope("gpt-oss")
	if flash != pro || claude != gpt || flash == claude {
		t.Fatal("provider group sharing lost")
	}
	_, argon := a.QuotaScope("gemini-4-argon-medium")
	if argon != flash {
		t.Fatal("invented separate Argon allowance without provider evidence")
	}
	a.cloudQuota.report = &core.UsageReport{Buckets: []core.UsageBucket{{QuotaGroup: "gemini-argon-"}}}
	_, argon = a.QuotaScope("gemini-4-argon-medium")
	if argon == flash {
		t.Fatal("ignored explicit Argon pool")
	}
}

func TestQuotaAggregateDeclaresSelectedPool(t *testing.T) {
	payload := decodeSample(t)
	r := mapQuotaSummary(payload, "gemini-3.8-flash-high", time.Now())
	if r.QuotaGroup != "gemini-" || r.Buckets[0].QuotaGroup != "gemini-" || r.Buckets[1].QuotaGroup != "3p-" {
		t.Fatalf("scope missing: %+v", r)
	}
	r = mapQuotaSummary(payload, "claude-sonnet-4-6", time.Now())
	if r.QuotaGroup != "3p-" || r.Buckets[0].QuotaGroup != "3p-" {
		t.Fatalf("wrong selected scope: %+v", r)
	}
}
