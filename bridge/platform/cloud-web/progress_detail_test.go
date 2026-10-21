package cloudweb

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestProgressCardDetailOption(t *testing.T) {
	cases := []struct {
		extra map[string]any
		want  string
	}{
		{nil, "brief"},
		{map[string]any{"progress_card_detail": "full"}, "full"},
		{map[string]any{"progress_card_detail": "nonsense"}, "brief"},
	}
	for _, c := range cases {
		var pl core.Platform = mustNew(t, wsOpts(c.extra))
		dp, ok := pl.(core.ProgressCardDetailProvider)
		if !ok {
			t.Fatal("cloud_web must implement ProgressCardDetailProvider")
		}
		if got := dp.ProgressCardDetail(); got != c.want {
			t.Fatalf("progress_card_detail=%v → %q, want %q", c.extra, got, c.want)
		}
	}
}
