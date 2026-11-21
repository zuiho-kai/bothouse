package core

import "testing"

func TestLookupPrice(t *testing.T) {
	prices := UsagePricesWithDefaults(nil)
	cases := []struct {
		model string
		want  float64
		found bool
	}{
		{"claude-opus-5-5", 4.0, true},      // exact hit
		{"xiao/gpt-6-astra", 10.0, true},    // provider prefix trimmed
		{"dx/gpt-6-astra", 10.0, true},      // same model, other provider
		{"gemini-4-argon-trial", 2.0, true}, // trial suffix trimmed
		{"gemini-3.8-flash-n", 0.75, true},  // variant suffix trimmed
		{"deepseek-v4.1-flash", 0.3, true},  // added from the official price page
		{"unknown-model-xyz", 0, false},     // stays unpriced
		// #2071: the Devin CLI catalog appends an effort tier to the base model id;
		// a devin turn on swe-2-max used to fall back to the table's highest rate
		// and hit the $5/turn cap in ~80s.
		{"swe-2-max", 0, true},               // devin-native, zero-priced
		{"swe-2-high", 0, true},              // effort suffix → swe-2
		{"swe-2-flash-medium", 0, true},      // effort suffix → swe-2-flash
		{"claude-fable-5-2-high", 8.0, true}, // effort suffix on a priced model
		{"claude-fable-5-2-medium", 8.0, true},
		{"gpt-5-4-none", 0, false}, // base has no price → still unpriced
		{"swe-1-6", 0.5, true},     // real catalog price (follow-up: not free)
	}
	for _, c := range cases {
		p, ok := lookupPrice(prices, c.model)
		if ok != c.found || (ok && p.Input != c.want) {
			t.Errorf("lookupPrice(%q) = %+v, %v; want input %v found=%v", c.model, p, ok, c.want, c.found)
		}
	}
}

// #2071 follow-up: an agent-registered catalog supplies ids the static table
// never heard of — paid tiers like -lightning whose rates no suffix rule can
// derive.
func TestLookupPriceProvider(t *testing.T) {
	RegisterUsagePriceProvider(func() map[string]TokenPrice {
		return map[string]TokenPrice{
			"swe-2-max-lightning": {Input: 1, Output: 5, CacheRead: 0.1},
			"catalog-only-model":  {Input: 3, Output: 9},
			"swe-2-max":           {Input: 2, Output: 6}, // a flipped-from-free tier
		}
	})
	if p, ok := lookupPrice(UsagePricesWithDefaults(nil), "swe-2-max-lightning"); !ok || p.Input != 1 || p.Output != 5 {
		t.Fatalf("provider rate: %+v found=%v", p, ok)
	}
	// A provider-prefixed id still resolves via the stripped base.
	if p, ok := lookupPrice(UsagePricesWithDefaults(nil), "xiao/catalog-only-model"); !ok || p.Input != 3 {
		t.Fatalf("provider rate after prefix strip: %+v found=%v", p, ok)
	}
	// Unknown everywhere stays unpriced.
	if _, ok := lookupPrice(UsagePricesWithDefaults(nil), "still-unknown"); ok {
		t.Fatal("unknown id must not gain a price")
	}
}

// #2071 review (G哥): when the catalog flips a tier from free to paid, the
// static table's $0 estimate for the stripped base ("swe-2-max" → "swe-2")
// must not mask the live full-id rate. Fails on the pre-fix lookup order.
// Registers its own provider — CI shards tests across processes, so no test
// may rely on another test's registration.
func TestLookupPriceProviderBeatsBaseEstimate(t *testing.T) {
	RegisterUsagePriceProvider(func() map[string]TokenPrice {
		return map[string]TokenPrice{"swe-2-max": {Input: 2, Output: 6}}
	})
	prices := map[string]TokenPrice{"swe-2": {}} // static $0 row for the base
	if p, ok := lookupPrice(prices, "swe-2-max"); !ok || p.Input != 2 {
		t.Fatalf("live catalog rate must beat $0 base estimate: %+v found=%v", p, ok)
	}
}
