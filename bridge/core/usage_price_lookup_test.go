package core

import "testing"

func TestLookupPrice(t *testing.T) {
	prices := UsagePricesWithDefaults(nil)
	cases := []struct {
		model string
		want  float64
		found bool
	}{
		{"claude-opus-5-5", 4.0, true},          // exact hit
		{"xiao/gpt-6-astra", 10.0, true},        // provider prefix trimmed
		{"dx/gpt-6-astra", 10.0, true},          // same model, other provider
		{"gemini-4-argon-trial", 2.0, true},     // trial suffix trimmed
		{"gemini-3.8-flash-n", 0.75, true},      // variant suffix trimmed
		{"deepseek-v4.1-flash", 0.3, true},      // added from the official price page
		{"unknown-model-xyz", 0, false},         // stays unpriced
	}
	for _, c := range cases {
		p, ok := lookupPrice(prices, c.model)
		if ok != c.found || (ok && p.Input != c.want) {
			t.Errorf("lookupPrice(%q) = %+v, %v; want input %v found=%v", c.model, p, ok, c.want, c.found)
		}
	}
}
