package main

import (
	"testing"

	"github.com/chenhg5/cc-connect/config"
)

func TestColdCacheFreshSettings(t *testing.T) {
	bp := func(b bool) *bool { return &b }
	ip := func(i int) *int { return &i }
	cases := []struct {
		name      string
		in        config.ColdCacheFreshConfig
		on        bool
		idle, min int
	}{
		{"unset defaults on", config.ColdCacheFreshConfig{}, true, 60, 80000},
		{"explicit true defaults", config.ColdCacheFreshConfig{Enabled: bp(true)}, true, 60, 80000},
		{"explicit false off", config.ColdCacheFreshConfig{Enabled: bp(false), IdleMins: ip(30)}, false, 0, 0},
		{"explicit values", config.ColdCacheFreshConfig{IdleMins: ip(90), MinTokens: ip(120000)}, true, 90, 120000},
		{"non-positive values ignored", config.ColdCacheFreshConfig{IdleMins: ip(0), MinTokens: ip(-1)}, true, 60, 80000},
	}
	for _, c := range cases {
		on, idle, min := coldCacheFreshSettings(c.in)
		if on != c.on || idle != c.idle || min != c.min {
			t.Errorf("%s: got (%v,%d,%d), want (%v,%d,%d)", c.name, on, idle, min, c.on, c.idle, c.min)
		}
	}
}
