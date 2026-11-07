package core

// #262 harness: a real out-of-process fake `dsh web` that answers 303 only for its own token and
// records every probe and every SIGTERM to a file, so a stop or a second start is observed without
// signalling the test process. Adapted from the #261 review probes
// (notes/reviews/evidence/261-open-dsh-multilog-20261107/zz_review261_common_test.go.txt).

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestH262HelperHost is the out-of-process fake `dsh web` (H262_HELPER=1).
func TestH262HelperHost(t *testing.T) {
	if os.Getenv("H262_HELPER") != "1" {
		t.Skip("helper process only")
	}
	token, eventFile, portFile := os.Getenv("H262_TOKEN"), os.Getenv("H262_EVENT_FILE"), os.Getenv("H262_PORT_FILE")
	record := func(s string) {
		f, err := os.OpenFile(eventFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return
		}
		_, _ = io.WriteString(f, s+"\n")
		_ = f.Close()
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(91)
	}
	if err := os.WriteFile(portFile, []byte(strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)), 0o600); err != nil {
		os.Exit(92)
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		s := <-sig
		record("signal:" + s.String())
		os.Exit(0)
	}()
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" || !r.URL.Query().Has("token") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		tok := r.URL.Query().Get("token")
		record("probe:" + tok)
		if tok == token {
			w.Header().Set("Location", "./")
			w.WriteHeader(http.StatusSeeOther)
			return
		}
		http.Error(w, "bad token", http.StatusUnauthorized)
	})
	_ = http.Serve(ln, h)
}

type h262Host struct {
	cmd   *exec.Cmd
	port  string
	event string
	done  chan struct{}
}

func h262StartHost(t *testing.T, token string) *h262Host {
	t.Helper()
	dir := t.TempDir()
	h := &h262Host{event: filepath.Join(dir, "events.log"), done: make(chan struct{})}
	portFile := filepath.Join(dir, "port")
	cmd := exec.Command(os.Args[0], "-test.run=TestH262HelperHost")
	cmd.Env = append(os.Environ(), "H262_HELPER=1", "H262_TOKEN="+token,
		"H262_EVENT_FILE="+h.event, "H262_PORT_FILE="+portFile)
	cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	h.cmd = cmd
	// Reap the child as soon as it exits: an unreaped zombie still answers kill(pid, 0).
	go func() { _ = cmd.Wait(); close(h.done) }()
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		select {
		case <-h.done:
		case <-time.After(5 * time.Second):
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for {
		if b, err := os.ReadFile(portFile); err == nil && strings.TrimSpace(string(b)) != "" {
			h.port = strings.TrimSpace(string(b))
			return h
		}
		if time.Now().After(deadline) {
			t.Fatal("helper host did not report a port")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func (h *h262Host) alive() bool {
	select {
	case <-h.done:
		return false
	default:
		return true
	}
}

func h262Events(t *testing.T, path string) []string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var out []string
	for _, l := range strings.Split(string(b), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			out = append(out, l)
		}
	}
	return out
}

func h262Signals(t *testing.T, h *h262Host) []string {
	var out []string
	for _, e := range h262Events(t, h.event) {
		if strings.HasPrefix(e, "signal:") {
			out = append(out, e)
		}
	}
	return out
}

// h262Probes is the tokens the host was asked to sign in with, in order.
func h262Probes(t *testing.T, h *h262Host) []string {
	var out []string
	for _, e := range h262Events(t, h.event) {
		if rest, ok := strings.CutPrefix(e, "probe:"); ok {
			out = append(out, rest)
		}
	}
	return out
}

// h262KnownProbes drops probes this test did not ask for: the bothouse running on this machine (and
// anything else scanning loopback) also probes every listener it finds with its own token.
func h262KnownProbes(t *testing.T, h *h262Host, known ...string) []string {
	t.Helper()
	ok := make(map[string]bool, len(known))
	for _, k := range known {
		ok[k] = true
	}
	var out, stray []string
	for _, p := range h262Probes(t, h) {
		if ok[p] {
			out = append(out, p)
			continue
		}
		stray = append(stray, p)
	}
	if len(stray) > 0 {
		t.Logf("ignored %d probe(s) from another process on this machine: %v", len(stray), stray)
	}
	return out
}

// h262World gives the test a HOME/collab dir of its own, a fake `dsh` (the script runs after the
// marker is touched, so any start is observable) and a short open wait.
func h262World(t *testing.T, dshScript string) (marker, releaseRoot string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("CONEST_COLLAB_DATA", filepath.Join(t.TempDir(), "collab"))
	resetDSHWebHeal(t)
	dir := t.TempDir()
	marker = filepath.Join(dir, "second-instance-started")
	fakeBin := filepath.Join(dir, "bin")
	if err := os.MkdirAll(fakeBin, 0o755); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\ntouch '" + marker + "'\n" + dshScript
	if err := os.WriteFile(filepath.Join(fakeBin, "dsh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	// /usr/sbin for lsof: the takeover resolves the pid that listens on a port.
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+"/usr/sbin:/usr/bin:/bin")
	if err := os.MkdirAll(filepath.Dir(dshWebStatePath()), 0o700); err != nil {
		t.Fatal(err)
	}
	oldWait := dshWebOpenWait
	dshWebOpenWait = 300 * time.Millisecond
	t.Cleanup(func() {
		dshWebOpenWait = oldWait
		dshWebMu.Lock()
		if dshWebStarting != nil {
			stopProcess(dshWebStarting.PID)
		}
		dshWebStarting = nil
		dshWebMu.Unlock()
		_ = os.Remove(dshWebStatePath())
		_ = os.Remove(dshWebStartingPath())
	})
	return marker, filepath.Join(dir, "releases")
}

func h262DefaultLog() string { return filepath.Join(filepath.Dir(dshWebStatePath()), "dsh-web.log") }

// h262ReleaseLog is <root>/<release>/dsh-web.log; the sibling scan reads <root>.
func h262ReleaseLog(t *testing.T, root, release string) string {
	t.Helper()
	return filepath.Join(root, release, "dsh-web.log")
}

func h262WriteLog(t *testing.T, path string, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func h262WriteState(t *testing.T, web DSHWeb) {
	t.Helper()
	b, err := json.Marshal(web)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dshWebStatePath(), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// h262URL is the plain loopback address (what a state file records); h262Line is the log line
// `dsh web` prints, which is what an announcement looks like.
func h262URL(port, token string) string  { return "http://127.0.0.1:" + port + "/?token=" + token }
func h262Line(port, token string) string { return "dsh web: " + h262URL(port, token) }

// h262PublicURL is the `--public-url` announcement shape: no port, tailnet host. The state file records
// the address alone (waitDSHWebLaunch stores what the log line captured), with the panel's hash.
func h262PublicURL(token string) string {
	return "https://mac-mini.example.ts.net/?token=" + token
}

// h262PublicLine is that address as `dsh web` prints it, which is what a log holds.
func h262PublicLine(token string) string { return "dsh web: " + h262PublicURL(token) }

// h262Started tells whether a `dsh web` was started, giving the fake's shell a moment to run.
func h262Started(t *testing.T, marker string) bool {
	t.Helper()
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if _, err := os.Stat(marker); err == nil {
			return true
		}
	}
	return false
}

func h262AssertNoSignal(t *testing.T, h *h262Host) {
	t.Helper()
	if s := h262Signals(t, h); len(s) != 0 {
		t.Fatalf("the live host was signalled: %v (events %v)", s, h262Events(t, h.event))
	}
}

func h262AssertAdopted(t *testing.T, h *h262Host, web DSHWeb, err error) {
	t.Helper()
	if err != nil || web.Starting || web.PID <= 0 || statePort(web.URL) != h.port {
		t.Fatalf("open = %+v %v, want the running host on port %s adopted (its events: %v)",
			web, err, h.port, h262Events(t, h.event))
	}
}

// h262CountStops swaps the stop hook for one that records the pid and still sends the signal.
func h262CountStops(t *testing.T) *[]int {
	t.Helper()
	calls := &[]int{}
	old := stopUntrackedDSHWeb
	stopUntrackedDSHWeb = func(pid int) error {
		*calls = append(*calls, pid)
		stopProcess(pid)
		for deadline := time.Now().Add(dshWebStopWait); processAlive(pid); time.Sleep(50 * time.Millisecond) {
			if time.Now().After(deadline) {
				return nil
			}
		}
		_ = os.Remove(dshWebStatePath())
		return nil
	}
	t.Cleanup(func() { stopUntrackedDSHWeb = old })
	return calls
}

// h262AssertServing fails unless port answers the launch-token gate with 303 for token.
func h262AssertServing(t *testing.T, port, token string) {
	t.Helper()
	if !probeDSHWebToken(port, token) {
		t.Fatalf("nothing serves 303 for token %q on port %s", token, port)
	}
}
