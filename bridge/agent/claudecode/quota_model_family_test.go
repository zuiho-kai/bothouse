package claudecode

import "testing"

func TestClaudeModelQuotaGroup(t *testing.T) {
	for _, tc := range []struct{ model, want string }{
		{"claude-fable-5-2", "model:fable"},
		{"claude-sonnet-4-5-20250929", "model:sonnet"},
		{"claude-3-5-sonnet-20241022", "model:sonnet"},
		{"opus[1m]", "model:opus"},
		{"haiku", "model:haiku"},
		{"", "account"},
		{"default", "account"},
	} {
		if got := claudeModelQuotaGroup(tc.model); got != tc.want {
			t.Errorf("%s => %s, want %s", tc.model, got, tc.want)
		}
	}
}
