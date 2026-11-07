package core

// #262 A: the state file's own token+port is the second gate when the log's announcement cannot
// name a usable host (the `--public-url` shape has no port), so a live host is neither stopped nor
// duplicated.

import (
	"context"
	"os"
	"testing"
	"time"
)

// A①: the only announcement is port-less (`--public-url`), its token is refused, and the state file
// still signs into the live host. That pair must be used: no stop, no second instance.
func TestOpenDSHWebUsesTheStateTokenForAPortlessAnnouncement(t *testing.T) {
	marker, root := h262World(t, "exit 3\n")
	host := h262StartHost(t, "good")
	recorded := h262ReleaseLog(t, root, "v0.1.52")
	h262WriteLog(t, recorded, h262PublicLine("rotated")) // the launchd unit's shape: no port
	h262WriteState(t, DSHWeb{URL: h262URL(host.port, "good") + "#channels", Log: recorded})

	stops := h262CountStops(t)
	web, err := openDSHWeb(context.Background(), t.TempDir())
	h262AssertAdopted(t, host, web, err)
	if len(*stops) != 0 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want none (the state file still signs in)", *stops)
	}
	if h262Started(t, marker) {
		t.Fatal("a second dsh web was started (it would hit the plugin's instance lock)")
	}
	h262AssertNoSignal(t, host)
	h262AssertServing(t, host.port, "good")
	probes := h262KnownProbes(t, host, "rotated", "good")
	if len(probes) < 2 || probes[0] != "rotated" || probes[len(probes)-1] != "good" {
		t.Fatalf("probes = %v, want the log's token first and the state file's last", probes)
	}
	if st := stateForTest(t); st.Log != recorded || statePort(st.URL) != host.port {
		t.Fatalf("state file = %+v, want the adopted url and log %s", st, recorded)
	}
}

// A②: no state file at all. The behaviour must be exactly the old one: nothing to fall back to, so
// the refused announcement is followed by a fresh start (and one stop of the announced host).
func TestOpenDSHWebWithoutAStateFileKeepsTheOldDecision(t *testing.T) {
	marker, _ := h262World(t, "exit 3\n")
	host := h262StartHost(t, "good")
	// No state file means no recorded log either: the default log is the only candidate, exactly as
	// before. Its announcement names the live port with a refused token.
	h262WriteLog(t, h262DefaultLog(), h262Line(host.port, "stale"))
	if err := os.Remove(dshWebStatePath()); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}

	stops := h262CountStops(t)
	if web, err := openDSHWeb(context.Background(), t.TempDir()); err == nil && !web.Starting {
		t.Fatalf("open = %+v, want a failure (the fake dsh exits at once)", web)
	}
	if len(*stops) != 1 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want exactly one (nothing proves that host)", *stops)
	}
	if !h262Started(t, marker) {
		t.Fatal("no new dsh web was attempted: the old behaviour was lost")
	}
}

// A③: the state file's token is bad too. Nothing may be adopted, and the open must not hang on the
// second gate: the old decision (one stop, then a fresh start) still applies.
func TestOpenDSHWebWithABadStateTokenFallsBackWithoutHanging(t *testing.T) {
	marker, root := h262World(t, "exit 3\n")
	host := h262StartHost(t, "good")
	recorded := h262ReleaseLog(t, root, "v0.1.52")
	h262WriteLog(t, recorded, h262Line(host.port, "stale"))
	h262WriteState(t, DSHWeb{URL: h262URL(host.port, "gone") + "#channels", Log: recorded})

	stops := h262CountStops(t)
	started := time.Now()
	if web, err := openDSHWeb(context.Background(), t.TempDir()); err == nil && !web.Starting {
		t.Fatalf("open = %+v, want a failure (the fake dsh exits at once)", web)
	}
	if took := time.Since(started); took > 20*time.Second {
		t.Fatalf("open took %s, want no hang on the second gate", took)
	}
	if len(*stops) != 1 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want exactly one", *stops)
	}
	if !h262Started(t, marker) {
		t.Fatal("no new dsh web was attempted after every candidate was refused")
	}
}

// A④: the state file recorded the address the host announced, and that shape has no port at all (the
// launchd unit passes `--public-url`, and waitDSHWebLaunch records the line verbatim). The token in
// the file is still the live host's, but a gate that needs a port out of the URL never runs, so the
// open starts a second `dsh web` into the plugin's instance lock while the first one is serving.
func TestOpenDSHWebUsesTheStateTokenWhenTheRecordedAddressHasNoPort(t *testing.T) {
	marker, root := h262World(t, "exit 3\n")
	host := h262StartHost(t, "good")
	recorded := h262ReleaseLog(t, root, "v0.1.52")
	h262WriteLog(t, recorded, h262PublicLine("rotated")) // an older instance's announcement
	h262WriteState(t, DSHWeb{URL: h262PublicURL("good") + "#channels", Log: recorded})

	stops := h262CountStops(t)
	web, err := openDSHWeb(context.Background(), t.TempDir())
	h262AssertAdopted(t, host, web, err)
	if len(*stops) != 0 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want none", *stops)
	}
	if h262Started(t, marker) {
		t.Fatal("a second dsh web was started although the state file's token still signs in")
	}
	h262AssertNoSignal(t, host)
	h262AssertServing(t, host.port, "good")
	if st := stateForTest(t); statePort(st.URL) != host.port || st.PID <= 0 {
		t.Fatalf("state file = %+v, want the loopback address with the real port recorded", st)
	}
}

// A⑤: the recorded port is stale because the host restarted on another port (a crash restart, a port
// already taken), and the log holds an older instance's refused token. The state file's token is
// still the live host's, so the listeners must be asked — otherwise the open stops a host it could
// have adopted and starts a second one into the instance lock.
func TestOpenDSHWebFindsAMovedHostWithTheStateToken(t *testing.T) {
	marker, root := h262World(t, "exit 3\n")
	host := h262StartHost(t, "good")
	gone := h262StartHost(t, "old") // the address the state file recorded, now a different host
	gonePort := gone.port
	recorded := h262ReleaseLog(t, root, "v0.1.52")
	h262WriteLog(t, recorded, h262Line(host.port, "rotated"))
	h262WriteState(t, DSHWeb{URL: h262URL(gonePort, "good") + "#channels", Log: recorded})

	stops := h262CountStops(t)
	web, err := openDSHWeb(context.Background(), t.TempDir())
	h262AssertAdopted(t, host, web, err)
	if len(*stops) != 0 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want none (the state token still signs in)", *stops)
	}
	if h262Started(t, marker) {
		t.Fatal("a second dsh web was started although the state file's token signs in on the live port")
	}
	h262AssertNoSignal(t, host)
	h262AssertNoSignal(t, gone)
}
