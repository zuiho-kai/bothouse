package core

import "testing"

// #1129: a turn interrupted by /stop or a gate abort ends its card as "aborted", not "failed".
func TestErrorTurnCardStateAborted(t *testing.T) {
	if got := errorTurnCardState(true); got != ProgressCardStateAborted {
		t.Fatalf("cancelled turn: got %q, want %q", got, ProgressCardStateAborted)
	}
	if got := errorTurnCardState(false); got != ProgressCardStateFailed {
		t.Fatalf("plain error: got %q, want %q", got, ProgressCardStateFailed)
	}
}
