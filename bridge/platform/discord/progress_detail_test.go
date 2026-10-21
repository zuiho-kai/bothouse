package discord

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestProgressCardDetailOption(t *testing.T) {
	cases := []struct {
		opts map[string]any
		want string
	}{
		{map[string]any{"token": "x"}, "brief"},
		{map[string]any{"token": "x", "progress_card_detail": "full"}, "full"},
		{map[string]any{"token": "x", "progress_card_detail": "bogus"}, "brief"},
	}
	for _, c := range cases {
		pl, err := New(c.opts)
		if err != nil {
			t.Fatalf("New(%v): %v", c.opts, err)
		}
		dp, ok := pl.(core.ProgressCardDetailProvider)
		if !ok {
			t.Fatalf("discord must implement ProgressCardDetailProvider")
		}
		if got := dp.ProgressCardDetail(); got != c.want {
			t.Fatalf("progress_card_detail=%v → %q, want %q", c.opts["progress_card_detail"], got, c.want)
		}
	}
}
