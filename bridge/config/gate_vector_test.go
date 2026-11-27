package config

import (
	"testing"

	"github.com/BurntSushi/toml"
)

// TestGateVectorURL: [gate] vector is off unless set (user 11-27「默认关」); on, the address defaults to embed_svc.py's.
func TestGateVectorURL(t *testing.T) {
	for _, c := range []struct {
		cfg  GateConfig
		want string
	}{
		{GateConfig{}, ""},
		{GateConfig{VectorURL: "http://127.0.0.1:1"}, ""}, // an address alone does not turn it on
		{GateConfig{Vector: true}, DefaultGateVectorURL},
		{GateConfig{Vector: true, VectorURL: "http://127.0.0.1:1"}, "http://127.0.0.1:1"},
	} {
		if got := c.cfg.GateVectorURL(); got != c.want {
			t.Errorf("%+v.GateVectorURL() = %q, want %q", c.cfg, got, c.want)
		}
	}
	var cfg Config
	if _, err := toml.Decode("[gate]\nvector = true\n", &cfg); err != nil {
		t.Fatal(err)
	}
	if !cfg.Gate.Vector {
		t.Fatal("[gate] vector = true not read")
	}
}
