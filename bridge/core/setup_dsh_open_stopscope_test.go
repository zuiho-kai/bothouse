package core

// #262 C3: a documentation case for the accepted change of stop surface. 78eecd42 (base) reaches a
// live host only through the default dsh-web.log; 1bffb536 and this branch reach it through any
// candidate log, so a host whose announcement sits in a release log is now stopped where base left it
// alone. That is intended (#261: the same announcement is what makes it adoptable), not a regression.
// The case below is the measurement, on real processes, so the PR sentence has a number behind it.

import (
	"context"
	"testing"
)

// The live host is announced only by the recorded release log; the default log does not exist. This
// branch stops that host once (it is the first candidate naming a loopback port whose token is
// refused) and starts a new one. Base stopped nothing and started one beside it — the behaviour this
// change deliberately replaces.
func TestOpenDSHWebStopsAHostAnnouncedByAReleaseLog(t *testing.T) {
	marker, root := h262World(t, "exit 3\n")
	host := h262StartHost(t, "good")
	recorded := h262ReleaseLog(t, root, "v0.1.52")
	h262WriteLog(t, recorded, h262Line(host.port, "stale"))
	h262WriteState(t, DSHWeb{URL: h262URL(host.port, "stale") + "#channels", Log: recorded})
	pid := pidListeningOnPort(host.port)

	calls := h262CountStops(t)
	_, _ = openDSHWeb(context.Background(), t.TempDir())
	if len(*calls) != 1 || (*calls)[0] != pid {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want [%d]: the release log's announcement is a candidate on this branch", *calls, pid)
	}
	if !h262Started(t, marker) {
		t.Fatal("nothing was started after the stop")
	}
}
