package claudecode

import (
	"fmt"
	"testing"
	"time"
)

func TestClaudeUsageSessionResetRollover(t *testing.T) {
	loc := mustLoadLocation(t, "Asia/Shanghai")
	for _, tc := range []struct {
		name         string
		hour, minute int
		reset        string
		wantSession  bool
		wantSeconds  int
	}{
		{"just expired", 3, 33, "3:30am", false, 0},
		{"at reset", 3, 30, "3:30am", false, 0},
		{"future", 3, 14, "3:30am", true, 16 * 60},
		{"across midnight", 23, 33, "3:30am", true, 3*3600 + 57*60},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Date(2026, 11, 17, tc.hour, tc.minute, 0, 0, loc)
			text := fmt.Sprintf("Current session\n42%% used\nResets %s (Asia/Shanghai)\nCurrent week (all models)\n10%% used\nResets Nov 20 at 3:30am (Asia/Shanghai)", tc.reset)
			report, err := parseClaudeUsageReport(text, now)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, w := range report.Buckets[0].Windows {
				if w.WindowSeconds != claudeUsageSessionWindowSeconds {
					continue
				}
				found = true
				if !tc.wantSession {
					t.Fatalf("expired session still reports old percentage: %+v", w)
				}
				if w.UsedPercent != 42 || w.ResetAfterSeconds != tc.wantSeconds {
					t.Fatalf("session = %+v; want 42%% used, reset in %d seconds", w, tc.wantSeconds)
				}
			}
			if found != tc.wantSession {
				t.Fatalf("session present = %v, want %v", found, tc.wantSession)
			}
		})
	}
}
