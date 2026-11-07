package core

// #262 C2: two logs, each with its own port and its own token, and two real hosts that each answer
// 303 only for their own token. The rule #261 was accepted with is that a token is never tried
// against another log's port: getting this wrong adopts nothing (both refused) or, worse, stops the
// host whose port the other log named.

import (
	"testing"
)

// hasProbe reports whether the host was asked for tok (stray probes from another process are fine,
// a token that does not belong to this log is not).
func hasProbe(probes []string, tok string) bool {
	for _, p := range probes {
		if p == tok {
			return true
		}
	}
	return false
}

// h262TwoLogWorld sets up hostA on logA's port and hostB on logB's port, both real processes.
type h262TwoLogWorld struct {
	a, b      *h262Host
	logA      string
	logB      string
	marker    string
	releaseAt string
}

func h262TwoLogs(t *testing.T, tokenA, tokenB, announcedA, announcedB string) *h262TwoLogWorld {
	t.Helper()
	// The `dsh` script is only a marker: neither case may start anything.
	marker, root := h262World(t, "exit 3\n")
	w := &h262TwoLogWorld{a: h262StartHost(t, tokenA), b: h262StartHost(t, tokenB), marker: marker}
	w.logA = h262ReleaseLog(t, root, "v0.1.52")
	w.logB = h262ReleaseLog(t, root, "v0.1.53")
	h262WriteLog(t, w.logA, h262Line(w.a.port, announcedA))
	h262WriteLog(t, w.logB, h262Line(w.b.port, announcedB))
	return w
}

// Both logs announce a token their own host accepts: the first log wins, and neither host is ever
// asked for the other log's token.
func TestOpenDSHWebNeverCrossesATokenBetweenLogs(t *testing.T) {
	w := h262TwoLogs(t, "alpha", "beta", "alpha", "beta")
	h262WriteState(t, DSHWeb{Log: w.logA})

	stops := h262CountStops(t)
	web, err := openDSHWeb(t.Context(), t.TempDir())
	h262AssertAdopted(t, w.a, web, err)
	if len(*stops) != 0 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want none", *stops)
	}
	if hasProbe(h262Probes(t, w.b), "alpha") {
		t.Fatalf("hostB was asked with logA's token (its events: %v)", h262Events(t, w.b.event))
	}
	if !hasProbe(h262Probes(t, w.a), "alpha") {
		t.Fatalf("hostA was never asked for its own token (its events: %v)", h262Events(t, w.a.event))
	}
	h262AssertNoSignal(t, w.a)
	h262AssertNoSignal(t, w.b)
}

// The first log's token is refused by its host, the second log's is accepted: the second host is
// adopted and the first host is never handed the second log's token (a wrong pairing here adopted
// hostB on hostA's port and stopped the wrong one).
func TestOpenDSHWebKeepsEachTokenOnItsOwnLogsPort(t *testing.T) {
	w := h262TwoLogs(t, "alpha", "beta", "rotated", "beta")
	h262WriteState(t, DSHWeb{Log: w.logA})

	stops := h262CountStops(t)
	web, err := openDSHWeb(t.Context(), t.TempDir())
	h262AssertAdopted(t, w.b, web, err)
	if len(*stops) != 0 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want none: hostB signs in", *stops)
	}
	if got := h262Probes(t, w.a); len(got) != 1 || got[0] != "rotated" {
		t.Fatalf("hostA received %v, want exactly its own log's token once", got)
	}
	// The unfiltered list on purpose: a stray token from another process is not the failure this
	// guards, but "rotated" on hostB can only come from logA's token being tried on logB's port.
	for _, tok := range h262Probes(t, w.b) {
		if tok == "rotated" {
			t.Fatalf("hostB was asked with logA's token (its events: %v)", h262Events(t, w.b.event))
		}
	}
	if !hasProbe(h262Probes(t, w.b), "beta") {
		t.Fatalf("hostB was never asked for its own log's token (its events: %v)", h262Events(t, w.b.event))
	}
	h262AssertNoSignal(t, w.a)
	h262AssertNoSignal(t, w.b)
}
