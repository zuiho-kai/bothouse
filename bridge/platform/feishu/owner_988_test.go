package feishu

import "testing"

func TestOwnerUserIDIsFirstAllowFrom(t *testing.T) {
	for in, want := range map[string]string{
		"ou_a, ou_b": "ou_a",
		"*":          "",
		"":           "",
		"*,ou_a":     "ou_a",
	} {
		if got := (&Platform{allowFrom: in}).OwnerUserID(); got != want {
			t.Fatalf("allow_from %q -> %q, want %q", in, got, want)
		}
	}
}
