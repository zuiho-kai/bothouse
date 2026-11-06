package core

import "testing"

// main.log 11-06 09:24–10:51 recorded 15 turns killed by the codex app-server reporting the cut
// bare: "Incomplete response returned, reason: adapter_eof" (user 10:53 「好几个工作区都这样」).
// \bEOF\b never matched inside adapter_eof, so the turn was not retried at all.
func TestAdapterEOFIsTransient(t *testing.T) {
	transient := []string{
		"Incomplete response returned, reason: adapter_eof",
		"stream disconnected before completion: Incomplete response returned, reason: adapter_eof",
	}
	for _, msg := range transient {
		if !isTransientError(msg) {
			t.Fatalf("%q must be retried", msg)
		}
	}
	// Still not retried: a spent quota sent with a 429 stays a quota cooldown, not a resend.
	if isTransientError("429 Too Many Requests: quota exceeded") {
		t.Fatal("spent quota must stay a cooldown")
	}
	// A real bad request is not retried because it mentions a cut.
	if isTransientError("400 Bad Request: invalid model") {
		t.Fatal("a 400 must stay permanent")
	}
}
