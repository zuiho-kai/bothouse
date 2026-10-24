package config

import (
	"github.com/BurntSushi/toml"
	"testing"
)

func TestUsagePricesConfiguration(t *testing.T) {
	var c Config
	_, err := toml.Decode("[usage_prices.\"model-id\"]\ninput=2.0\noutput=4.0\ncache_read=0.2\ncache_write=2.5\n", &c)
	if err != nil {
		t.Fatal(err)
	}
	p, ok := c.UsagePrices["model-id"]
	if !ok || p.Input != 2 || p.CacheRead != 0.2 {
		t.Fatalf("%+v", c.UsagePrices)
	}
	if err = p.Validate(); err != nil {
		t.Fatal(err)
	}
	p.Input = -1
	c.UsagePrices["model-id"] = p
	if err = c.validateInternal(true); err == nil {
		t.Fatal("negative price accepted")
	}
}
