package config

import (
	"testing"

	"github.com/BurntSushi/toml"
)

// gate_local: unset = on (user 2026-10-23 「默认打开」); false turns the built-in busy rules off.
func TestGateLocalEnabledDefaultsOn(t *testing.T) {
	for raw, want := range map[string]bool{
		``:                   true,
		`gate_local = true`:  true,
		`gate_local = false`: false,
	} {
		var p ProjectConfig
		if _, err := toml.Decode(raw, &p); err != nil {
			t.Fatalf("decode %q: %v", raw, err)
		}
		if got := p.GateLocalEnabled(); got != want {
			t.Errorf("%q: GateLocalEnabled() = %v, want %v", raw, got, want)
		}
	}
}
