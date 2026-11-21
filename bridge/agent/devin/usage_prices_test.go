package devin

import "testing"

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
		if p.Input != c.in || p.Output != c.out || p.CacheRead != c.cache {
			t.Errorf("%s = %+v; want in %v out %v cache %v", c.uid, p, c.in, c.out, c.cache)
		}
	}
	if _, ok := got["not-a-model"]; ok {
		t.Fatal("phantom uid gained a price")
	}
	// #2071 review (G哥): a paid tier without a parseable rate must stay
	// unknown — never written as free.
	for _, uid := range []string{"paid-no-summary", "paid-garbage-summary"} {
		if _, ok := got[uid]; ok {
			t.Fatalf("%s: unparseable paid tier recorded as a price", uid)
		}
	}
	if parseCatalogPrices([]byte("not json")) != nil {
		t.Fatal("malformed catalog must yield nil, not panic")
	}
}
