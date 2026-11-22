package devin

import (
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Sample mirrors `devin models list --format json` fields the parser uses.
const catalogSample = `{"families":[
 {"family_uid":"swe-2","variants":[
   {"model_uid":"swe-2-max","cost_tier":"Free"},
   {"model_uid":"swe-2-max-lightning","cost_tier":"High cost",
    "cost_summary":"$1 / 1M Input · $0.1 / 1M Cached input · $5 / 1M Output"}]},
 {"family_uid":"claude-fable-5.2","variants":[
   {"model_uid":"claude-fable-5-2-high","cost_summary":"$8 / 1M Input · $0.2 / 1M Cached input · $40 / 1M Output"},
   {"model_uid":"claude-fable-5-2-high-fast","cost_summary":"$16 / 1M Input · $0.4 / 1M Cached input · $80 / 1M Output"}]},
 {"family_uid":"fusion","variants":[
   {"model_uid":"fusion-gpt-6-astra-max-sidekick-claude-haiku-5-5-medium",
    "cost_summary":"$10 / 1M Input · $1 / 1M Cached input · $50 / 1M Output · $0.1 / 1M Sidekick input · $0.01 / 1M Sidekick cached input · $0.5 / 1M Sidekick output"}]},
 {"family_uid":"edge","variants":[
   {"model_uid":"paid-no-summary","cost_tier":"High cost"},
   {"model_uid":"paid-garbage-summary","cost_tier":"High cost","cost_summary":"see your plan"},
   {"model_uid":"free-with-summary","cost_tier":"Free","cost_summary":"$7 / 1M Input · $35 / 1M Output"}]}
]}`

// #2071 follow-up: the devin catalog is the live price source — free tiers,
// paid variants and sidekick segments must land on the right fields.
func TestParseCatalogPrices(t *testing.T) {
	got := parseCatalogPrices([]byte(catalogSample))
	cases := []struct {
		uid            string
		in, out, cache float64
	}{
		{"swe-2-max", 0, 0, 0},                      // Free → explicit zero
		{"swe-2-max-lightning", 1, 5, 0.1},          // paid tier ≠ base rate
		{"claude-fable-5-2-high", 8, 40, 0.2},       // thinking effort = base rate
		{"claude-fable-5-2-high-fast", 16, 80, 0.4}, // fast tier = 2×
		{"fusion-gpt-6-astra-max-sidekick-claude-haiku-5-5-medium", 10, 50, 1},
		{"free-with-summary", 7, 35, 0}, // a parseable summary wins over the Free tier
	}
	for _, c := range cases {
		p, ok := got[c.uid]
		if !ok {
			t.Fatalf("%s missing from catalog prices", c.uid)
		}
		if p == nil {
			t.Fatalf("%s listed without a rate", c.uid)
		}
		if p.Input != c.in || p.Output != c.out || p.CacheRead != c.cache {
			t.Errorf("%s = %+v; want in %v out %v cache %v", c.uid, p, c.in, c.out, c.cache)
		}
	}
	if _, ok := got["not-a-model"]; ok {
		t.Fatal("phantom uid gained a price")
	}
	// #2071 review (G哥): a paid tier without a parseable rate must stay
	// unknown — never written as free — but listed (nil), so lookup does not
	// strip it down to a base model's rate (#2073).
	for _, uid := range []string{"paid-no-summary", "paid-garbage-summary"} {
		if p, ok := got[uid]; !ok || p != nil {
			t.Fatalf("%s: unparseable paid tier = %v, listed=%v; want listed with nil price", uid, p, ok)
		}
	}
	if parseCatalogPrices([]byte("not json")) != nil {
		t.Fatal("malformed catalog must yield nil, not panic")
	}
}

// #2073 (G哥 review): the catalog marks swe-2-max paid but gives no rate. From
// the `devin models list` JSON through the registered provider to the ledger's
// price lookup, that usage must come out unpriced — not $0 via the "-max" strip
// to the static swe-2 row.
func TestCatalogPaidNoPriceStaysUnpriced(t *testing.T) {
	const catalog = `{"families":[{"family_uid":"swe-2","variants":[
	  {"model_uid":"swe-2","cost_tier":"Free"},
	  {"model_uid":"swe-2-max","cost_tier":"High cost"}]}]}`
	catalogCache.mu.Lock()
	saved, savedAt := catalogCache.prices, catalogCache.fetched
	catalogCache.prices, catalogCache.fetched = parseCatalogPrices([]byte(catalog)), time.Now()
	catalogCache.mu.Unlock()
	t.Cleanup(func() {
		catalogCache.mu.Lock()
		catalogCache.prices, catalogCache.fetched = saved, savedAt
		catalogCache.mu.Unlock()
	})

	ledger := core.NewUsageLedger(t.TempDir(), core.UsagePricesWithDefaults(nil))
	now := time.Now()
	for _, model := range []string{"swe-2-max", "swe-2"} {
		if err := ledger.Record(core.UsageRecord{Time: now, Role: "devin", Model: model, Input: 1000, Output: 1000, Known: true}); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := ledger.Query(now.Add(-time.Hour), now.Add(time.Hour), "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, r := range rows {
		seen[r.Model] = true
		switch r.Model {
		case "swe-2-max":
			if r.EstimatedCost != nil || r.Unpriced != 1 {
				t.Errorf("paid swe-2-max without a rate priced at %v (unpriced=%d); want unpriced", r.EstimatedCost, r.Unpriced)
			}
		case "swe-2": // catalog Free → explicit $0 (user 11-22 04:40)
			if r.EstimatedCost == nil || *r.EstimatedCost != 0 {
				t.Errorf("free swe-2 = %v (unpriced=%d); want $0", r.EstimatedCost, r.Unpriced)
			}
		}
	}
	if !seen["swe-2-max"] || !seen["swe-2"] {
		t.Fatalf("ledger rows missing models: %+v", rows)
	}
}
