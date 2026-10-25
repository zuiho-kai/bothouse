package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// The gate (contrib/gate/gate.py) as a child process of bothouse: the wizard turns the gate on by
// default for a team of bots, so bothouse starts the gate itself instead of asking the user to run
// `uv run gate.py`. One code path for macOS, Linux and Windows; the gate comes and goes with bothouse
// (which `bothouse daemon install` can already run as a service).
//
// The Python is ProductPython (python_env.go: PATH, else uv, else uv downloaded into <data_dir>/tools), the
// same one the role wikis use. Without one the gate is not started. Without a jev the gate still starts and
// serves /context (each turn's wiki pages and task board) and /lead, but not /decide: there, as when the gate
// is not running, core/gate.go fallbackFor applies: an @-mentioned bot answers, every other message goes to
// the lead.

// GateScriptFS holds contrib/gate/{gate,scorer_remote,ctxsvc,wiki_search,lead,board}.py and
// team.example.json (embed_gate.go, set in cmd/cc-connect).
var GateScriptFS fs.FS

// Gate status as the wizard reports it (WizardResult.GateStatus).
const (
	GateStatusRunning       = "running"
	GateStatusStarting      = "starting"
	GateStatusPythonMissing = "python_missing"
	GateStatusPythonTooOld  = "python_too_old"
	GateStatusJevMissing    = "jev_missing"
	GateStatusOff           = "off"
)

// UsesLocalGate reports whether a project's gate_url is the gate this machine runs (the URL the
// wizard writes, localGateURL); a hand-written URL elsewhere is someone else's gate.
func UsesLocalGate(gateURL string) bool { return isWizardGateURL(gateURL) }

// PersistGatePort writes a gate port the supervisor had to move to into config.toml ([gate] port);
// set by cmd/cc-connect (config.SetGatePort). nil = only this process knows the new port.
var PersistGatePort func(port int) error

// gateWhoami asks the gate on gateAddr which data dir it serves (gate.py GET /whoami); "" = no
// answer (nothing there, an older gate without /whoami, or not a gate at all).
func gateWhoami() string {
	c := http.Client{Timeout: time.Second} // 本机接口，1s 足够
	resp, err := c.Get("http://" + localGateAddr() + "/whoami")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var out struct {
		DataDir string `json:"data_dir"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out) != nil {
		return ""
	}
	return out.DataDir
}

func sameDir(a, b string) bool {
	clean := func(p string) string {
		if abs, err := filepath.Abs(p); err == nil {
			p = abs
		}
		if r, err := filepath.EvalSymlinks(p); err == nil {
			p = r
		}
		return filepath.Clean(p)
	}
	return a != "" && b != "" && clean(a) == clean(b)
}

// gateIsOurs: the gate on gateAddr serves dataDir (so it can be reused).
func gateIsOurs(dataDir string) bool { return sameDir(gateWhoami(), dataDir) }

// Who holds the gate port (gatePortHolder).
type gateHolder int

const (
	gateHolderNone    gateHolder = iota // nothing listens there
	gateHolderOurs                      // /whoami names this data dir
	gateHolderUnknown                   // no /whoami answer: an older gate.py, gate_switch.py, not HTTP
	gateHolderForeign                   // /whoami names another data dir: another bothouse
)

func gatePortHolder(dataDir string) gateHolder {
	if portFree(LocalGatePort()) {
		return gateHolderNone
	}
	who := gateWhoami()
	switch {
	case who == "":
		return gateHolderUnknown
	case sameDir(who, dataDir):
		return gateHolderOurs
	}
	return gateHolderForeign
}

// keepGatePort is the one rule (supervisor and wizard) for staying on the current gate port:
// moved only when another data dir's gate answers there, or when a gate that cannot say whose it
// is holds it and this data dir's config does not point at that port yet (a fresh install). An
// existing install keeps its port with an older gate on it (the launchd gate.py before /whoami).
func keepGatePort(h gateHolder, configPointsHere bool) bool {
	switch h {
	case gateHolderForeign:
		return false
	case gateHolderUnknown:
		return configPointsHere
	}
	return true
}

// pickGatePort: the gate port for dataDir (keepGatePort); when it has to move, 9930 if free, else
// a free one. Never another install's gate.
func pickGatePort(dataDir string, configPointsHere bool) int {
	cur := LocalGatePort()
	if keepGatePort(gatePortHolder(dataDir), configPointsHere) {
		return cur
	}
	if cur != defaultGatePort && portFree(defaultGatePort) {
		return defaultGatePort
	}
	return PickFreePort(0)
}

// gateLauncher runs gate.py and exits as soon as bothouse closes the pipe on its stdin, so the gate
// never outlives bothouse (a crash or kill -9 included), on every OS. gate.py itself is not changed.
const gateLauncher = `import os, runpy, sys, threading
threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()
sys.argv = ["gate.py"]
runpy.run_path("gate.py", run_name="__main__")`

// gatePythonCheck exits 0 when this Python can run gate.py.
// 来源：contrib/gate/gate.py 文件头 requires-python = ">=3.12"。
const gatePythonCheck = "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"

// findPythonForGate is swappable in tests.
var findPythonForGate = ProductPython

// gatePythonOK caches the version check per interpreter path (python312).
var gatePythonOK sync.Map

// GatePrereq reports whether the gate can start on this machine: the Python to run it with, or
// the reason it can't (python_missing | python_too_old). A missing jev does not stop it: the gate then
// serves /context and /lead only (contrib/gate/gate.py make_scorer). The first call may download uv and
// Python (ProductPython).
func GatePrereq(dataDir string) (python, reason string) {
	p, err := findPythonForGate(dataDir)
	if errors.Is(err, ErrPythonTooOld) {
		return "", GateStatusPythonTooOld
	}
	if err != nil {
		return "", GateStatusPythonMissing
	}
	return p, ""
}

// installGateScripts writes the embedded gate into <data_dir>/gate (always the binary's copy:
// this directory belongs to bothouse; the user's own gate lives elsewhere).
func installGateScripts(dir string) error {
	if GateScriptFS == nil {
		return errors.New("the gate is not built into this binary")
	}
	return fs.WalkDir(GateScriptFS, "contrib/gate", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(GateScriptFS, p)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		return AtomicWriteFile(filepath.Join(dir, filepath.Base(p)), b, 0o644)
	})
}

// Timings of the supervisor; vars so tests can shorten them.
var (
	// 来源：本机 launchd 跑 gate 的 ThrottleInterval 10（~/Library/LaunchAgents/com.zuiho.maomao-gate.plist）：
	// 起来不到 10s 就退出算「启动失败」（没 jev、端口被占、脚本报错），不重启，等输入变了再试。
	gateQuickExit = 10 * time.Second
	// 来源：方案「退出后按指数退避重启（上限 60s）」；同一个数也用作没起来时多久再看一次（装好 python / jev 自动启用）。
	gateMaxBackoff = 60 * time.Second
	gateRecheck    = 60 * time.Second
	// 停 gate 时等它退出多久再强杀（关掉 stdin 后 launcher 立即 os._exit，5s 只是兜底）
	gateStopWait = 5 * time.Second
)

// GateSupervisor starts, restarts and stops the local gate for one bothouse data dir.
type GateSupervisor struct {
	dataDir  string
	dir      string // <data_dir>/gate
	roleWiki string // the directory of the role wikis' bots.json (SetRoleWikiDir); "" = <data_dir>/wiki

	op       sync.Mutex // one step / stop at a time: a gate being stopped is never seen as someone else's
	mu       sync.Mutex
	want     bool
	external bool   // the gate port was taken by a gate bothouse did not start: leave it alone
	failedFP string // inputs of the last start that failed quickly: no retry until they change
	cmd      *exec.Cmd
	stdin    io.Closer
	exited   chan struct{}
	started  time.Time
	backoff  time.Duration
	kick     chan struct{}
	done     chan struct{}
	stopOnce sync.Once
}

var (
	activeGateMu sync.Mutex
	activeGate   *GateSupervisor
)

// NewGateSupervisor makes the supervisor; Run starts its loop.
func NewGateSupervisor(dataDir string) *GateSupervisor {
	return &GateSupervisor{dataDir: dataDir, dir: filepath.Join(dataDir, "gate"),
		kick: make(chan struct{}, 1), done: make(chan struct{})}
}

// SetRoleWikiDir names the directory holding bots.json (roleWikiSetup.dir: the user's sub-wiki.py's own when
// the config has that hook, else RoleWikiDir). Set before Run; the gate rereads bots.json itself (ctxsvc.py).
func (g *GateSupervisor) SetRoleWikiDir(dir string) {
	g.mu.Lock()
	g.roleWiki = dir
	g.mu.Unlock()
}

// gateWikiEnv: the wikis /context searches (contrib/gate/ctxsvc.py): GATE_WIKI = the main wiki (FindWiki, so
// $WIKI_DIR counts), GATE_WIKI_BOTS = bots.json, whose entries name each role's own wiki. A GATE_WIKI already
// in the environment (e.g. "off") is kept.
func gateWikiEnv(dataDir, roleWikiDir string) []string {
	var env []string
	if _, set := os.LookupEnv("GATE_WIKI"); !set {
		mw, _ := FindWiki()
		if mw != "" {
			env = append(env, "GATE_WIKI="+mw)
		}
	}
	if roleWikiDir == "" {
		roleWikiDir = RoleWikiDir(dataDir)
	}
	return append(env, "GATE_WIKI_BOTS="+filepath.Join(roleWikiDir, "bots.json"))
}

// SetActiveGateSupervisor registers the running service's supervisor, so a wizard run in this
// process can start (or reload) the gate right after it saves.
func SetActiveGateSupervisor(g *GateSupervisor) {
	activeGateMu.Lock()
	activeGate = g
	activeGateMu.Unlock()
}

func activeGateFor(dataDir string) *GateSupervisor {
	activeGateMu.Lock()
	defer activeGateMu.Unlock()
	if activeGate == nil || filepath.Clean(activeGate.dataDir) != filepath.Clean(dataDir) {
		return nil
	}
	return activeGate
}

// Run starts the loop; want = some project uses the local gate.
func (g *GateSupervisor) Run(want bool) {
	g.mu.Lock()
	g.want = want
	g.mu.Unlock()
	go g.loop()
	g.poke()
}

// Reload applies a new config: the gate reads gate-team.json and jev.json only at startup, so a
// gate bothouse started is restarted; one it did not start is left alone.
func (g *GateSupervisor) Reload(want bool) {
	g.mu.Lock()
	g.want = want
	g.failedFP = ""
	g.backoff = 0
	g.mu.Unlock()
	g.stopChild()
	g.poke()
}

// Want turns the gate on without restarting a running one: the DSH route needs it once its
// members are set up (EnsureGateForDSH), whatever the projects say.
func (g *GateSupervisor) Want() {
	g.mu.Lock()
	g.want = true
	g.mu.Unlock()
	g.poke()
}

// Stop stops the loop and the gate.
func (g *GateSupervisor) Stop() {
	g.stopOnce.Do(func() { close(g.done) })
	g.stopChild()
}

func (g *GateSupervisor) poke() {
	select {
	case g.kick <- struct{}{}:
	default:
	}
}

func (g *GateSupervisor) loop() {
	t := time.NewTimer(gateRecheck)
	defer t.Stop()
	for {
		wait := g.step()
		if !t.Stop() {
			select {
			case <-t.C:
			default:
			}
		}
		t.Reset(wait)
		g.mu.Lock()
		exited := g.exited
		g.mu.Unlock()
		select {
		case <-g.done:
			return
		case <-g.kick:
		case <-t.C:
		case <-exitedOrNever(exited):
		}
	}
}

func exitedOrNever(c chan struct{}) <-chan struct{} {
	if c == nil {
		return nil
	}
	return c
}

// step looks at the gate once and returns when to look again.
func (g *GateSupervisor) step() time.Duration {
	g.mu.Lock()
	need := g.want && !g.external && g.cmd == nil
	g.mu.Unlock()
	if need {
		// the first time this may download uv and Python (minutes): outside the locks, so Reload / Stop
		// do not wait on it; GatePrereq below then gets the cached answer
		_, _ = findPythonForGate(g.dataDir)
	}
	g.op.Lock()
	defer g.op.Unlock()
	g.mu.Lock()
	defer g.mu.Unlock()
	select {
	case <-g.done:
		return gateRecheck
	default:
	}
	if g.cmd != nil {
		select {
		case <-g.exited:
			ran := time.Since(g.started)
			fp := g.inputsLocked()
			g.cmd, g.stdin, g.exited = nil, nil, nil
			if ran < gateQuickExit {
				g.failedFP = fp
				slog.Warn("gate: exited right after start; not restarting until jev, the team or python changes",
					"ran", ran.Round(time.Millisecond), "log", g.logPath())
				return gateRecheck
			}
			if g.backoff == 0 {
				g.backoff = time.Second
			} else if g.backoff *= 2; g.backoff > gateMaxBackoff {
				g.backoff = gateMaxBackoff
			}
			slog.Warn("gate: exited; restarting", "ran", ran.Round(time.Second), "in", g.backoff, "log", g.logPath())
			return g.backoff
		default:
			return gateRecheck // running
		}
	}
	if !g.want || g.external {
		return gateRecheck
	}
	// g.want: this data dir's config has a gate_url on this machine's gate, i.e. it points here
	if h := gatePortHolder(g.dataDir); h != gateHolderNone {
		if keepGatePort(h, true) {
			// this data dir's gate, or an older one that cannot say whose it is, started before
			// bothouse: by hand / launchd / systemd
			g.external = true
			if h == gateHolderUnknown {
				slog.Warn("gate: a gate without /whoami is already listening; bothouse will not start its own", "addr", localGateAddr())
			} else {
				slog.Info("gate: this data dir's gate is already listening; bothouse will not start its own", "addr", localGateAddr())
			}
			return gateRecheck
		}
		// another bothouse's gate: never share it, move to a free port
		old := localGateAddr()
		port := PickFreePort(0)
		SetLocalGatePort(port)
		if PersistGatePort != nil {
			if err := PersistGatePort(port); err != nil {
				slog.Warn("gate: cannot write the new gate port to config", "port", port, "error", err)
			}
		}
		slog.Warn("gate: the gate port belongs to another data dir; moved", "from", old, "to", localGateAddr())
	}
	py, reason := GatePrereq(g.dataDir)
	if reason != "" {
		return gateRecheck // core/gate.go fallbackFor: the lead answers until python / jev are there
	}
	if fp := g.inputsLocked(); fp == g.failedFP {
		return gateRecheck
	}
	if err := g.startLocked(py); err != nil {
		slog.Warn("gate: start failed", "error", err)
		g.failedFP = g.inputsLocked()
	}
	return gateRecheck
}

// inputsLocked: what the gate reads at startup. A quick failure is retried once one changes.
func (g *GateSupervisor) inputsLocked() string {
	py, _ := findPythonForGate(g.dataDir)
	fp := py
	for _, f := range []string{jevFile, gateTeamFile} {
		if st, err := os.Stat(filepath.Join(g.dataDir, f)); err == nil {
			fp += fmt.Sprintf("|%s:%d:%d", f, st.Size(), st.ModTime().UnixNano())
		}
	}
	return fp
}

// gatePort: the port of gateAddr, where bothouse looks for the gate (GateRunning).
func gatePort() string {
	if _, port, err := net.SplitHostPort(localGateAddr()); err == nil {
		return port
	}
	return "9930"
}

func (g *GateSupervisor) logPath() string { return filepath.Join(g.dataDir, "logs", "gate.log") }

func (g *GateSupervisor) startLocked(python string) error {
	if err := installGateScripts(g.dir); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(g.logPath()), 0o755); err != nil {
		return err
	}
	logf, err := os.OpenFile(g.logPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	cmd := exec.Command(python, "-c", gateLauncher)
	cmd.Dir = g.dir
	cmd.Env = append(append(os.Environ(), gateWikiEnv(g.dataDir, g.roleWiki)...),
		// Both names point at the bridge's data dir so the gate never mixes it with an inherited one
		// (contrib/gate/datadir.py: lead.json follows BOTHOUSE_DATA_DIR, the rest GATE_SETUP_DIR).
		"GATE_SETUP_DIR="+g.dataDir,
		"BOTHOUSE_DATA_DIR="+g.dataDir,
		"GATE_PORT="+gatePort(),
		"GATE_LOG="+filepath.Join(g.dataDir, "gate.jsonl"),
		"PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8")
	cmd.Stdout, cmd.Stderr = logf, logf
	hideWindow(cmd)
	in, err := cmd.StdinPipe()
	if err != nil {
		logf.Close()
		return err
	}
	if err := cmd.Start(); err != nil {
		logf.Close()
		return err
	}
	exited := make(chan struct{})
	go func() { // the loop wakes up on exited
		_ = cmd.Wait()
		logf.Close()
		close(exited)
	}()
	g.cmd, g.stdin, g.exited, g.started = cmd, in, exited, time.Now()
	slog.Info("gate: started", "pid", cmd.Process.Pid, "dir", g.dir, "log", g.logPath())
	return nil
}

// stopChild stops a gate bothouse started: closing its stdin ends it (gateLauncher); killed if it
// is still there after gateStopWait.
func (g *GateSupervisor) stopChild() {
	g.op.Lock()
	defer g.op.Unlock()
	g.mu.Lock()
	cmd, in, exited := g.cmd, g.stdin, g.exited
	g.cmd, g.stdin, g.exited = nil, nil, nil
	g.mu.Unlock()
	if cmd == nil {
		return
	}
	_ = in.Close()
	select {
	case <-exited:
	case <-time.After(gateStopWait):
		_ = cmd.Process.Kill()
		<-exited
	}
	slog.Info("gate: stopped", "pid", cmd.Process.Pid)
}

// gateStatusAfterWizard: the gate line of a wizard result for a team with the gate on.
func gateStatusAfterWizard(dataDir string) string {
	if GateRunning() {
		return GateStatusRunning
	}
	if _, reason := GatePrereq(dataDir); reason != "" {
		return reason
	}
	return GateStatusStarting
}

// reloadGateAfterWizard starts / restarts / stops the gate of the service running in this process
// after a wizard run saved (a CLI `setup apply` has none: the gate starts with the restart).
func reloadGateAfterWizard(dataDir string, s WizardSnapshot) {
	g := activeGateFor(dataDir)
	if g == nil {
		return
	}
	want := DSHRouteConfigured() // DSH-native members read /context too (dsh/collab/gate-context.mjs)
	for _, p := range s.Projects {
		if UsesLocalGate(p.GateURL) {
			want = true
		}
	}
	g.Reload(want)
}

// EnsureGateForDSH starts the gate of the service running in this process for the DSH route:
// with only DSH-native members there is no project whose gate_url points at the local gate, so
// nothing else would start it, and the members' per-turn /context (wiki pages, task board) would
// never answer. Called when bothouse starts `dsh web` (openDSHWeb).
func EnsureGateForDSH(dataDir string) {
	if g := activeGateFor(dataDir); g != nil {
		g.Want()
	}
}
