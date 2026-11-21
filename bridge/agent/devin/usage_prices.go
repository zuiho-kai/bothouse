package devin

// usage_prices.go feeds the Devin CLI's own model catalog into the bridge's
// price table (#2071 follow-up). `devin models list --format json` names every
// variant's rate — including paid tiers like -lightning, -fast and -priority
// whose prices differ from the base model and can never be derived by suffix
// stripping — so the catalog is queried live instead of being hand-keyed into
// core's default table.

import (
	"context"
	"encoding/json"
	"os/exec"
	"regexp"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func init() {
	core.RegisterUsagePriceProvider(catalogPrices)
}

// catalogTTL caps how often `devin models list` is spawned; the catalog only
// changes with CLI releases, so hourly freshness is ample. 来源: trade-off
// between a subprocess per lookup and stale prices — an hour keeps new CLI
// catalogs picked up the same day.
const catalogTTL = time.Hour

// catalogTimeout bounds the CLI call so a wedged devin binary cannot stall a
// usage lookup. 来源: `devin models list` completes in well under a second on
// this machine (measured during #2071); 10s is a generous failure bound, not a
// tuned value.
const catalogTimeout = 10 * time.Second

var catalogCache struct {
	mu      sync.Mutex
	fetched time.Time
	prices  map[string]*core.TokenPrice
}

// catalogBin is the devin binary the configured agent session actually spawns
// (New() records it). The bridge may run under a service PATH without
// ~/.local/bin, so a bare LookPath("devin") is only the fallback for contexts
// where no Agent was ever created.
var catalogBin atomic.Value // string

// catalogPrices returns model_uid → rate for every variant in the Devin
// catalog; a paid variant without a parseable rate maps to nil ("listed, price
// unknown"). Errors leave the previous cache (or an empty map) in
// place: a missing price is safer than a stalled lookup, and the caller's
// fallback already handles misses.
func catalogPrices() map[string]*core.TokenPrice {
	catalogCache.mu.Lock()
	defer catalogCache.mu.Unlock()
	if time.Since(catalogCache.fetched) < catalogTTL {
		return catalogCache.prices
	}
	bin, _ := catalogBin.Load().(string)
	if bin == "" {
		bin = "devin"
	}
	bin, err := exec.LookPath(bin)
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), catalogTimeout)
		defer cancel()
		if out, err := exec.CommandContext(ctx, bin, "models", "list", "--format", "json").Output(); err == nil {
			catalogCache.prices = parseCatalogPrices(out)
		}
	}
	catalogCache.fetched = time.Now()
	return catalogCache.prices
}

// modelsList mirrors `devin models list --format json`.
type modelsList struct {
	Families []struct {
		Variants []struct {
			ModelUID    string `json:"model_uid"`
			CostTier    string `json:"cost_tier"`
			CostSummary string `json:"cost_summary"`
		} `json:"variants"`
	} `json:"families"`
}

// cost_summary reads "$8 / 1M Input · $0.2 / 1M Cached input · $40 / 1M Output"
// (fusion variants append "· $0.1 / 1M Sidekick input · …"; those segments are
// deliberately unmatched — sidekick tokens are not part of the recorded usage).
var (
	costInput  = regexp.MustCompile(`\$([\d.]+)\s*/\s*1M Input`)
	costCached = regexp.MustCompile(`\$([\d.]+)\s*/\s*1M Cached input`)
	costOutput = regexp.MustCompile(`\$([\d.]+)\s*/\s*1M Output`)
)

func parseCatalogPrices(data []byte) map[string]*core.TokenPrice {
	var list modelsList
	if err := json.Unmarshal(data, &list); err != nil {
		return nil
	}
	out := make(map[string]*core.TokenPrice)
	for _, fam := range list.Families {
		for _, v := range fam.Variants {
			if v.ModelUID == "" {
				continue
			}
			if p, ok := parseCostSummary(v.CostSummary); ok {
				out[v.ModelUID] = &p
				continue
			}
			if v.CostTier == "Free" {
				out[v.ModelUID] = &core.TokenPrice{}
				continue
			}
			// A paid/unknown tier with an empty or unrecognized summary is
			// listed as nil — "price unknown" — so lookup neither records it
			// as free nor strips it down to a base model's $0 (#2071 review,
			// #2073: swe-2-max paid must not fall back to swe-2's zero row).
			out[v.ModelUID] = nil
		}
	}
	return out
}

// parseCostSummary extracts the three recorded rates; ok reports whether any
// field was found at all (an absent cache column is legitimately $0).
func parseCostSummary(summary string) (core.TokenPrice, bool) {
	p := core.TokenPrice{}
	var found bool
	for _, field := range []struct {
		dst *float64
		re  *regexp.Regexp
	}{{&p.Input, costInput}, {&p.Output, costOutput}, {&p.CacheRead, costCached}} {
		if m := field.re.FindStringSubmatch(summary); m != nil {
			*field.dst, _ = strconv.ParseFloat(m[1], 64)
			found = true
		}
	}
	return p, found
}
