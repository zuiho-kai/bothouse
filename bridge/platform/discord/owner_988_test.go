package discord

import "testing"

func TestOwnerUserIDIsFirstAllowFrom(t *testing.T) {
	for in, want := range map[string]string{
		"1498, 727,157": "1498",
		"*":             "",
		"":              "",
		"*,1498":        "1498",
	} {
		if got := (&Platform{allowFrom: in}).OwnerUserID(); got != want {
			t.Fatalf("allow_from %q -> %q, want %q", in, got, want)
		}
	}
}
