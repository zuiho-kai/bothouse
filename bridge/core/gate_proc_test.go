package core

import (
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// fakeGatePy stands in for contrib/gate/gate.py: it counts its starts in <data_dir>/starts.txt,
// (only when BOTHOUSE_DATA_DIR equals it), then either exits at once (FAKE_GATE_MODE=exit) or listens on GATE_PORT like the real gate.
const fakeGatePy = `import os, socket, sys
if os.environ.get("BOTHOUSE_DATA_DIR") != os.environ["GATE_SETUP_DIR"]:
    sys.exit(4)  # both must name the bridge's data dir, not an inherited one
with open(os.path.join(os.environ["GATE_SETUP_DIR"], "starts.txt"), "a") as f:
    f.write("start\n")
if os.environ.get("FAKE_GATE_MODE") == "exit":
    sys.exit(3)
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(os.environ["GATE_PORT"])))
s.listen(8)
while True:
    c, _ = s.accept()
    c.close()
`

// setupFakeGate: a temp data dir with a jev, a free port as gateAddr, any python3 (its version
// check is pre-answered) running fakeGatePy, and short supervisor timings.
func setupFakeGate(t *testing.T, withJev bool) (dataDir string) {
	t.Helper()
	py, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not on PATH")
	}
	dataDir = t.TempDir()
	t.Setenv("BOTHOUSE_DATA_DIR", filepath.Join(dataDir, "inherited")) // the supervisor must override it
	if withJev {
		if err := writeJSONFile(filepath.Join(dataDir, jevFile), JevConfig{Backend: "llm", URL: "http://127.0.0.1:1/v1", Model: "m", Logprobs: true}, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()

	oldFS, oldAddr, oldFind := GateScriptFS, gateAddr, findPythonForGate
	oldQuick, oldMax, oldRe, oldWait := gateQuickExit, gateMaxBackoff, gateRecheck, gateStopWait
	t.Cleanup(func() {
		GateScriptFS, gateAddr, findPythonForGate = oldFS, oldAddr, oldFind
		gateQuickExit, gateMaxBackoff, gateRecheck, gateStopWait = oldQuick, oldMax, oldRe, oldWait
		gatePythonOK.Delete(py)
	})
	GateScriptFS = fstest.MapFS{"contrib/gate/gate.py": {Data: []byte(fakeGatePy)}}
	gateAddr = addr
	findPythonForGate = func() (string, error) { return py, nil }
	gatePythonOK.Store(py, true)
	gateQuickExit, gateMaxBackoff, gateRecheck, gateStopWait = 2*time.Second, time.Second, 200*time.Millisecond, 2*time.Second
	return dataDir
}

func gateStarts(dataDir string) int {
	b, _ := os.ReadFile(filepath.Join(dataDir, "starts.txt"))
	return strings.Count(string(b), "start")
}

func waitGate(t *testing.T, what string, d time.Duration, ok func() bool) {
	t.Helper()
	for end := time.Now().Add(d); time.Now().Before(end); time.Sleep(50 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestGateSupervisorStartsReloadsStops(t *testing.T) {
	dataDir := setupFakeGate(t, true)
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	waitGate(t, "gate listening", 10*time.Second, GateRunning)
	if n := gateStarts(dataDir); n != 1 {
		t.Fatalf("starts = %d, want 1", n)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "logs", "gate.log")); err != nil {
		t.Fatalf("gate log: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "gate", "gate.py")); err != nil {
		t.Fatalf("scripts not released into <data_dir>/gate: %v", err)
	}

	g.Reload(true) // the gate reads gate-team.json / jev.json only at startup: restarted
	waitGate(t, "restart after Reload", 10*time.Second, func() bool { return gateStarts(dataDir) == 2 && GateRunning() })
	if g.external {
		t.Fatal("a gate bothouse started must not be taken for someone else's")
	}

	g.Reload(false) // the wizard switched the gate off
	waitGate(t, "gate stopped after Reload(false)", 10*time.Second, func() bool { return !GateRunning() })

	g.Reload(true)
	waitGate(t, "gate back", 10*time.Second, GateRunning)
	g.Stop()
	waitGate(t, "gate gone after Stop", 10*time.Second, func() bool { return !GateRunning() })
}

func TestGateSupervisorQuickExitNotRestarted(t *testing.T) {
	dataDir := setupFakeGate(t, true)
	t.Setenv("FAKE_GATE_MODE", "exit")
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	waitGate(t, "first start", 10*time.Second, func() bool { return gateStarts(dataDir) >= 1 })
	time.Sleep(2 * time.Second) // ~10 recheck rounds
	if n := gateStarts(dataDir); n != 1 {
		t.Fatalf("a gate that exits right after start was started %d times, want 1", n)
	}
	// a changed input (a new jev) is retried
	if err := writeJSONFile(filepath.Join(dataDir, jevFile), JevConfig{Backend: "llm", URL: "http://127.0.0.1:2/v1", Model: "m2", Logprobs: true}, 0o600); err != nil {
		t.Fatal(err)
	}
	waitGate(t, "retry after the jev changed", 10*time.Second, func() bool { return gateStarts(dataDir) == 2 })
}

func TestGateSupervisorLeavesExternalGate(t *testing.T) {
	dataDir := setupFakeGate(t, true)
	l, err := net.Listen("tcp", gateAddr) // someone else's gate (launchd, by hand)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	time.Sleep(time.Second)
	if n := gateStarts(dataDir); n != 0 {
		t.Fatalf("started %d gates while the port was taken, want 0", n)
	}
	g.Reload(true)
	time.Sleep(time.Second)
	if n := gateStarts(dataDir); n != 0 {
		t.Fatalf("Reload started %d gates over an external one, want 0", n)
	}
}

func TestGateSupervisorNoJevNoStart(t *testing.T) {
	dataDir := setupFakeGate(t, false)
	if _, reason := GatePrereq(dataDir); reason != GateStatusJevMissing {
		t.Fatalf("GatePrereq reason = %q, want %q", reason, GateStatusJevMissing)
	}
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	time.Sleep(time.Second)
	if n := gateStarts(dataDir); n != 0 {
		t.Fatalf("started %d gates without a jev, want 0", n)
	}
	// filled in later (the wizard's jev step): picked up on the next recheck
	if err := writeJSONFile(filepath.Join(dataDir, jevFile), JevConfig{Backend: "llm", URL: "http://127.0.0.1:1/v1", Model: "m", Logprobs: true}, 0o600); err != nil {
		t.Fatal(err)
	}
	waitGate(t, "start once the jev is there", 10*time.Second, GateRunning)
}
