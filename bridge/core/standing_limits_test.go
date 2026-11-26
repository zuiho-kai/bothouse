package core

import (
	"os"
	"testing"
)

// main sets StandingLimitsJSON from the embedded contrib/gate/standing_limits.json; core's own tests read the same file.
func init() {
	if StandingLimitsJSON == nil {
		StandingLimitsJSON, _ = os.ReadFile("../contrib/gate/standing_limits.json")
	}
}

func TestStandingLimitsReadFromGateFile(t *testing.T) {
	lines, chars := StandingLimits()
	if lines <= 0 || chars <= 0 {
		t.Fatalf("StandingLimits() = %d, %d; want both read from contrib/gate/standing_limits.json", lines, chars)
	}
	if DefaultReadFrequencySmallChars() != chars {
		t.Fatalf("small-chars default %d != STANDING.md char limit %d", DefaultReadFrequencySmallChars(), chars)
	}
}
