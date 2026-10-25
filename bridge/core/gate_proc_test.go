package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
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
const fakeGatePy = `import http.server, json, os, sys
if os.environ.get("BOTHOUSE_DATA_DIR") != os.environ["GATE_SETUP_DIR"]:
    sys.exit(4)  # both must name the bridge's data dir, not an inherited one
with open(os.path.join(os.environ["GATE_SETUP_DIR"], "starts.txt"), "a") as f:
    f.write("start\n")
with open(os.path.join(os.environ["GATE_SETUP_DIR"], "wiki_env.txt"), "w") as f:
    f.write(os.environ.get("GATE_WIKI", "") + "\n" + os.environ.get("GATE_WIKI_BOTS", ""))
if os.environ.get("FAKE_GATE_MODE") == "exit":
    sys.exit(3)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # like gate.py GET /whoami
        b = json.dumps({"ok": True, "data_dir": os.environ["BOTHOUSE_DATA_DIR"]}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
http.server.HTTPServer.allow_reuse_address = True
http.server.HTTPServer(("127.0.0.1", int(os.environ["GATE_PORT"])), H).serve_forever()
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
	findPythonForGate = func(string) (string, error) { return py, nil }
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
	if b, _ := os.ReadFile(filepath.Join(dataDir, "wiki_env.txt")); !strings.HasSuffix(string(b), "\n"+filepath.Join(dataDir, "wiki", "bots.json")) {
		t.Fatalf("gate env GATE_WIKI / GATE_WIKI_BOTS = %q, want bots.json under <data_dir>/wiki", b)
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

// whoamiServer: a gate on addr that says it serves dataDir (GET /whoami, like gate.py).
func whoamiServer(t *testing.T, addr, dataDir string) {
	t.Helper()
	l, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data_dir": dataDir})
	})}
	go srv.Serve(l)
	t.Cleanup(func() { srv.Close() })
}

func TestGateSupervisorLeavesOwnDataDirGate(t *testing.T) {
	dataDir := setupFakeGate(t, true)
	whoamiServer(t, gateAddr, dataDir) // this data dir's gate run by hand / launchd
	addr := localGateAddr()
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	time.Sleep(time.Second)
	if n := gateStarts(dataDir); n != 0 || localGateAddr() != addr {
		t.Fatalf("started %d gates / moved to %s over this data dir's own gate, want 0 / %s", n, localGateAddr(), addr)
	}
	g.Reload(true)
	time.Sleep(time.Second)
	if n := gateStarts(dataDir); n != 0 {
		t.Fatalf("Reload started %d gates over this data dir's own gate, want 0", n)
	}
}

// Another install's gate (or anything not answering /whoami with this data dir) on the port: never
// shared; the supervisor moves to a free port, saves it and starts its own gate there.
func TestGateSupervisorMovesOffForeignGate(t *testing.T) {
	for _, tc := range []struct {
		name    string
		foreign func(t *testing.T, addr string)
	}{
		{"other data dir", func(t *testing.T, addr string) { whoamiServer(t, addr, t.TempDir()) }},
		{"not a gate", func(t *testing.T, addr string) {
			l, err := net.Listen("tcp", addr)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { l.Close() })
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := setupFakeGate(t, true)
			taken := localGateAddr()
			tc.foreign(t, taken)
			saved := 0
			oldPersist := PersistGatePort
			t.Cleanup(func() { PersistGatePort = oldPersist })
			PersistGatePort = func(p int) error { saved = p; return nil }
			g := NewGateSupervisor(dataDir)
			g.Run(true)
			defer g.Stop()
			waitGate(t, "own gate on a new port", 10*time.Second, func() bool { return gateStarts(dataDir) == 1 && gateIsOurs(dataDir) })
			if localGateAddr() == taken || saved != LocalGatePort() {
				t.Fatalf("addr %s (taken %s), saved %d", localGateAddr(), taken, saved)
			}
		})
	}
}

func TestGateSupervisorStartsWithoutJev(t *testing.T) {
	// a clean machine has no jev: the gate still starts (gate.py then serves /context and /lead only;
	// /decide falls back to gate_fallback), so each turn still gets its wiki pages and task board
	dataDir := setupFakeGate(t, false)
	if _, reason := GatePrereq(dataDir); reason != "" {
		t.Fatalf("GatePrereq reason = %q without a jev, want none", reason)
	}
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	waitGate(t, "start without a jev", 10*time.Second, GateRunning)
}

func TestGatePrereqPythonReasons(t *testing.T) {
	old := findPythonForGate
	t.Cleanup(func() { findPythonForGate = old })
	findPythonForGate = func(string) (string, error) { return "", fmt.Errorf("%w; download failed", ErrPythonTooOld) }
	if _, r := GatePrereq(t.TempDir()); r != GateStatusPythonTooOld {
		t.Fatalf("too old: %q", r)
	}
	findPythonForGate = func(string) (string, error) { return "", errors.New("no python, no uv, download failed") }
	if _, r := GatePrereq(t.TempDir()); r != GateStatusPythonMissing {
		t.Fatalf("missing: %q", r)
	}
}

// #597 K11: a machine with only DSH-native members has no project with the local gate_url; the
// gate still runs for them (their per-turn /context), once `dsh web` starts and on every reload.
func TestGateRunsForDSHRouteOnly(t *testing.T) {
	dataDir := setupFakeGate(t, false)
	t.Setenv("CONEST_COLLAB_DATA", t.TempDir())
	if DSHRouteConfigured() {
		t.Fatal("no wizard-members.json yet: not the DSH route")
	}
	g := NewGateSupervisor(dataDir)
	SetActiveGateSupervisor(g)
	t.Cleanup(func() { SetActiveGateSupervisor(nil) })
	g.Run(false)
	defer g.Stop()
	time.Sleep(300 * time.Millisecond)
	if n := gateStarts(dataDir); n != 0 {
		t.Fatalf("no project, no DSH members: gate started %d times", n)
	}
	if err := os.WriteFile(dshMembersFile(), []byte(`{"members":[{"name":"ds"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	EnsureGateForDSH(dataDir)
	waitGate(t, "gate started for the DSH route", 5*time.Second, GateRunning)
	reloadGateAfterWizard(dataDir, WizardSnapshot{}) // no projects: the DSH members keep it wanted
	waitGate(t, "gate back after reload", 5*time.Second, func() bool { return gateStarts(dataDir) == 2 && GateRunning() })
}

// TestGateWikiEnv: /context searches the main wiki FindWiki names ($WIKI_DIR counts) plus the roles' wikis listed
// in bots.json (the user's sub-wiki.py directory when set, else <data_dir>/wiki); a GATE_WIKI already set is kept.
func TestGateWikiEnv(t *testing.T) {
	data, mw, own := t.TempDir(), t.TempDir(), t.TempDir()
	t.Setenv("WIKI_DIR", mw)
	t.Setenv("GATE_WIKI", "") // restored after the test
	os.Unsetenv("GATE_WIKI")
	got := strings.Join(gateWikiEnv(data, ""), " ")
	if want := "GATE_WIKI=" + mw + " GATE_WIKI_BOTS=" + filepath.Join(data, "wiki", "bots.json"); got != want {
		t.Fatalf("env = %q, want %q", got, want)
	}
	got = strings.Join(gateWikiEnv(data, own), " ")
	if want := "GATE_WIKI=" + mw + " GATE_WIKI_BOTS=" + filepath.Join(own, "bots.json"); got != want {
		t.Fatalf("own sub-wiki dir: env = %q, want %q", got, want)
	}
	t.Setenv("GATE_WIKI", "off")
	if got := strings.Join(gateWikiEnv(data, ""), " "); strings.Contains(got, "GATE_WIKI=") {
		t.Fatalf("a GATE_WIKI already set must be kept, got %q", got)
	}
}
