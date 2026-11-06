package claudecode

import (
	"testing"
	"time"
)

func TestParseClaudeUsageResetTimeWithAt(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Tokyo")
	now := time.Date(2026, 11, 6, 11, 50, 0, 0, loc)
	got, err := parseClaudeUsageResetTime("Nov 6 at 2pm (Asia/Tokyo)", now)
	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 11, 6, 14, 0, 0, 0, loc); !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
