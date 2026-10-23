package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

// Post-update self-check. After an update (web button, chat /upgrade, `bothouse update` while
// running) replaces the binary and restarts, the old binary
// (kept as the backup by replaceBinary) runs as a detached guard: it waits for the new process to
// answer GET /api/v1/status with the new version. If that does not happen in time, it stops the
// new process, puts the old binary back, restarts it, and leaves a note that the web page shows
// ("新版没能启动，已退回 vX").
//
// Only binaries that contain this code can guard their own update: the guard is the version that
// performs the update, so it applies from the release that ships this file onwards.

// UpdateGuardTimeout: how long the new version may take to answer /status.
// 来源：用户和审查都没给数（审查只要求「失败或超时则回退」）；没有实测启动耗时，取 90 秒，
// 给慢盘、杀软首次扫描新文件和 Windows 服务重拉留余量，真机测过再调。前端等待上限（VersionBadge RESTART_WAIT_MS）要比它加回退宽限期更长。
var UpdateGuardTimeout = 90 * time.Second

// updateGuardGrace: after the rollback, how long to wait for launchd / the Windows service /
// the console supervisor to bring the old binary back before starting it ourselves.
// 来源：同上无给数；launchd KeepAlive 默认节流 10 秒（launchd.plist ThrottleInterval 默认值），取 15 秒。
var updateGuardGrace = 15 * time.Second

// updateGuardPoll: /status poll interval. 来源：无给数，1 秒对本机 HTTP 足够且不费资源。
const updateGuardPoll = time.Second

const (
	UpdateGuardArg    = "__update-guard"
	updateGuardEnv    = "BOTHOUSE_UPDATE_GUARD"
	updateResultFile  = "update-result.json"
	updatePendingFile = "update-pending.json"
	updateNewPIDFile  = "update-newpid"
)

// UpdateStateDir is where the guard writes its result; main sets it to cfg.DataDir.
var UpdateStateDir string

// updateGuardSpec is handed to the guard process through the environment (keeps the token off
// the command line).
type updateGuardSpec struct {
	StatusURL string `json:"status_url"`
	// SocketPath: local API socket, probed via GET /version when StatusURL is empty (management off).
	SocketPath string   `json:"socket_path,omitempty"`
	Token      string   `json:"token"`
	Want       string   `json:"want"`
	Old        string   `json:"old"`
	Exe        string   `json:"exe"`
	Backup     string   `json:"backup"`
	PID        int      `json:"pid"` // the updating process; same PID after exec(2) on unix
	Args       []string `json:"args"`
	StateDir   string   `json:"state_dir"`
	TimeoutSec int      `json:"timeout_sec"`
	GraceSec   int      `json:"grace_sec"`
	// Notify: chat that asked for the update (/upgrade); told in plain words when it is rolled back.
	Notify *RestartRequest `json:"notify,omitempty"`
}

// UpdateResult is what the page reads back after a restart (GET /api/v1/update → last_result).
type UpdateResult struct {
	Status string `json:"status"` // "ok" | "rolled_back" | "rollback_failed"
	From   string `json:"from"`   // version that was running before
	To     string `json:"to"`     // version that was tried
	Detail string `json:"detail,omitempty"`
	At     int64  `json:"at"`
}

func updateStatePath(dir, name string) string { return filepath.Join(dir, name) }

func writeUpdateResult(dir string, r UpdateResult) {
	if dir == "" {
		return
	}
	r.At = time.Now().Unix()
	b, _ := json.Marshal(r)
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(updateStatePath(dir, updateResultFile), b, 0o644)
}

// ReadUpdateResult returns the last guard result, if any.
func ReadUpdateResult(dir string) *UpdateResult {
	if dir == "" {
		return nil
	}
	b, err := os.ReadFile(updateStatePath(dir, updateResultFile))
	if err != nil {
		return nil
	}
	var r UpdateResult
	if json.Unmarshal(b, &r) != nil {
		return nil
	}
	return &r
}

// ClearUpdateResult removes the note once the page has shown it.
func ClearUpdateResult(dir string) {
	if dir != "" {
		_ = os.Remove(updateStatePath(dir, updateResultFile))
	}
}

// NoteUpdateStart is called early by main: while a guard is waiting, record our PID so it can
// stop us (on Windows the restarted process has a new PID).
func NoteUpdateStart(dir string) {
	if dir == "" {
		return
	}
	if _, err := os.Stat(updateStatePath(dir, updatePendingFile)); err != nil {
		return
	}
	_ = os.WriteFile(updateStatePath(dir, updateNewPIDFile), []byte(fmt.Sprint(os.Getpid())), 0o644)
}

// startUpdateGuard launches the backup (old) binary as the guard. Swappable in tests.
var startUpdateGuard = func(spec updateGuardSpec) error {
	b, err := json.Marshal(spec)
	if err != nil {
		return err
	}
	if spec.StateDir != "" {
		_ = os.MkdirAll(spec.StateDir, 0o755)
		_ = os.Remove(updateStatePath(spec.StateDir, updateResultFile))
		_ = os.Remove(updateStatePath(spec.StateDir, updateNewPIDFile))
		if err := os.WriteFile(updateStatePath(spec.StateDir, updatePendingFile), b, 0o600); err != nil {
			return err
		}
	}
	// The marker next to the binary lets the new version roll itself back at its next start,
	// even when the guard is gone (update_marker.go).
	if err := writeUpdateMarker(spec, 0); err != nil {
		return err
	}
	cmd := exec.Command(spec.Backup, UpdateGuardArg)
	cmd.Env = append(os.Environ(), updateGuardEnv+"="+string(b))
	detachCmd(cmd)
	if err := cmd.Start(); err != nil {
		removeUpdateMarker(spec.Exe)
		return err
	}
	return cmd.Process.Release()
}

// swapBackOld moves the new binary to <exe>.failed-<n> (a running binary can be renamed on unix
// and Windows) and the backup back to exe, and records the result.
func swapBackOld(spec updateGuardSpec) (UpdateResult, bool) {
	failed := strings.Replace(BinaryBackupPath(spec.Exe), ".old-", ".failed-", 1)
	if err := os.Rename(spec.Exe, failed); err != nil && !os.IsNotExist(err) {
		r := UpdateResult{Status: "rollback_failed", From: spec.Old, To: spec.Want, Detail: "move new binary aside: " + err.Error()}
		writeUpdateResult(spec.StateDir, r)
		return r, false
	}
	if err := os.Rename(spec.Backup, spec.Exe); err != nil {
		_ = os.Rename(failed, spec.Exe)
		r := UpdateResult{Status: "rollback_failed", From: spec.Old, To: spec.Want, Detail: "restore old binary: " + err.Error()}
		writeUpdateResult(spec.StateDir, r)
		return r, false
	}
	r := UpdateResult{Status: "rolled_back", From: spec.Old, To: spec.Want}
	writeUpdateResult(spec.StateDir, r)
	return r, true
}

// RunUpdateGuard is the entry of `<backup> __update-guard`.
func RunUpdateGuard() int {
	var spec updateGuardSpec
	if err := json.Unmarshal([]byte(os.Getenv(updateGuardEnv)), &spec); err != nil {
		slog.Error("update guard: bad spec", "error", err)
		return 2
	}
	_ = os.Unsetenv(updateGuardEnv)
	runUpdateGuard(spec, guardOps{})
	return 0
}

// guardOps holds the side effects, swapped in tests.
type guardOps struct {
	probe func(spec updateGuardSpec) string // version answered by /status, "" if none
	kill  func(pid int)
	start func(exe string, args []string) error
	sleep func(time.Duration)
	now   func() time.Time
}

func (o *guardOps) fill() {
	if o.probe == nil {
		o.probe = probeStatusVersion
	}
	if o.kill == nil {
		o.kill = func(pid int) {
			if p, err := os.FindProcess(pid); err == nil {
				_ = p.Kill()
			}
		}
	}
	if o.start == nil {
		o.start = func(exe string, args []string) error {
			cmd := exec.Command(exe, args...)
			detachCmd(cmd)
			if err := cmd.Start(); err != nil {
				return err
			}
			return cmd.Process.Release()
		}
	}
	if o.sleep == nil {
		o.sleep = time.Sleep
	}
	if o.now == nil {
		o.now = time.Now
	}
}

// activeAPISocket is the local API socket path (set when the socket listens): the self-check
// probes it when the management HTTP server is off.
var activeAPISocket atomic.Value // string

// handleSocketVersion: GET /version on the local socket → {"version": "..."}.
func handleSocketVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"version": CurrentVersion})
}

func probeStatusVersion(spec updateGuardSpec) string {
	url, c := spec.StatusURL, &http.Client{Timeout: 3 * time.Second}
	if url == "" {
		if spec.SocketPath == "" {
			return ""
		}
		sock := spec.SocketPath
		c.Transport = &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", sock)
		}}
		url = "http://unix/version"
	}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return ""
	}
	if spec.Token != "" {
		req.Header.Set("Authorization", "Bearer "+spec.Token)
	}
	resp, err := c.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	var body struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
		Version string `json:"version"`
	}
	if json.NewDecoder(resp.Body).Decode(&body) != nil {
		return ""
	}
	if body.Data.Version != "" {
		return body.Data.Version
	}
	return body.Version
}

func sameVersion(a, b string) bool {
	return strings.TrimPrefix(a, "v") == strings.TrimPrefix(b, "v")
}

func waitForVersion(spec updateGuardSpec, ops guardOps, want string, d time.Duration) bool {
	deadline := ops.now().Add(d)
	for {
		if v := ops.probe(spec); v != "" && (want == "" || sameVersion(v, want)) {
			return true
		}
		if !ops.now().Before(deadline) {
			return false
		}
		ops.sleep(updateGuardPoll)
	}
}

func runUpdateGuard(spec updateGuardSpec, ops guardOps) UpdateResult {
	ops.fill()
	defer os.Remove(updateStatePath(spec.StateDir, updatePendingFile))
	timeout := time.Duration(spec.TimeoutSec) * time.Second
	grace := time.Duration(spec.GraceSec) * time.Second

	if waitForVersion(spec, ops, spec.Want, timeout) {
		r := UpdateResult{Status: "ok", From: spec.Old, To: spec.Want}
		writeUpdateResult(spec.StateDir, r)
		_ = os.Remove(updateStatePath(spec.StateDir, updateNewPIDFile))
		removeUpdateMarker(spec.Exe) // self-check passed: later starts of the new version are normal
		slog.Info("update guard: new version is serving", "version", spec.Want)
		return r
	}

	if !updateMarkerExists(spec.Exe) {
		// The new version already rolled itself back at a restart (recoverPendingUpdate) and is
		// running as the old binary now: nothing left to swap, and nothing to kill.
		slog.Info("update guard: already rolled back at startup", "want", spec.Want)
		return UpdateResult{Status: "rolled_back", From: spec.Old, To: spec.Want}
	}
	slog.Warn("update guard: new version did not come up, rolling back", "want", spec.Want, "old", spec.Old)
	// The chat that asked for the update hears about it from the old binary once it is back up
	// (it reads restart_notify at startup), so the note is written before anything is swapped.
	if spec.Notify != nil && spec.StateDir != "" {
		n := *spec.Notify
		n.Text = fmt.Sprintf("新版 %s 没能启动，已退回 %s", spec.Want, spec.Old)
		_ = SaveRestartNotify(spec.StateDir, n)
	}
	// Put the old binary back first, then stop the new process: under systemd (default
	// KillMode=control-group) stopping the main process also kills this guard, so the files must
	// already be swapped by then and the supervisor's restart picks up the old binary.
	r, ok := swapBackOld(spec)
	removeUpdateMarker(spec.Exe) // swapped back (or cannot be): the startup check has nothing to do
	if !ok {
		return r
	}
	// Stop the new process (it may be hung rather than dead).
	if b, err := os.ReadFile(updateStatePath(spec.StateDir, updateNewPIDFile)); err == nil {
		var pid int
		if _, err := fmt.Sscan(strings.TrimSpace(string(b)), &pid); err == nil && pid > 0 {
			ops.kill(pid)
		}
	} else if spec.PID > 0 && spec.PID != os.Getpid() {
		ops.kill(spec.PID) // unix: exec(2) kept the PID
	}
	_ = os.Remove(updateStatePath(spec.StateDir, updateNewPIDFile))

	// A supervisor (launchd KeepAlive, the Windows service script) may bring it back by itself;
	// otherwise start the old binary with the same arguments.
	if waitForVersion(spec, ops, "", grace) {
		return r
	}
	if err := ops.start(spec.Exe, spec.Args); err != nil {
		r.Status = "rollback_failed"
		r.Detail = "start old binary: " + err.Error()
		writeUpdateResult(spec.StateDir, r)
	}
	return r
}

// activeMgmt is the running management server: the self-check asks its /status whether the new
// version is up. Set by ManagementServer.Start.
var activeMgmt atomic.Pointer[ManagementServer]

// armUpdateGuard is the one self-check every update entry goes through — the web button, chat
// /upgrade and `bothouse update` — after the binary was replaced and before the restart: the old
// binary watches the new one and puts itself back if it does not come up. notify: the chat to
// tell about a rollback (nil for web/CLI; the page reads the result file). If the guard cannot
// be started, the replacement is undone and an error is returned: never restart unguarded into
// a version that might not come up.
func armUpdateGuard(m *ManagementServer, want string, notify *RestartRequest) error {
	spec := m.guardSpec(want) // m nil (management off): probe the local socket instead
	spec.Notify = notify
	var why error
	switch {
	case spec.Backup == "":
		why = errors.New("no backup of the old binary")
	case spec.StatusURL == "" && spec.SocketPath == "":
		why = errors.New("neither management api nor local socket to check the new version")
	}
	if why != nil {
		// Never restart unguarded: undo the replacement, same as a guard that cannot start.
		slog.Error("update: cannot self-check, undoing update", "error", why)
		if spec.Backup != "" {
			if uerr := undoReplace(spec); uerr != nil {
				slog.Error("update: undo failed", "error", uerr)
			}
		}
		return errors.Join(errUpdateRestart, why)
	}
	if err := startUpdateGuard(spec); err != nil {
		slog.Error("update: start self-check failed, undoing update", "error", err)
		if uerr := undoReplace(spec); uerr != nil {
			slog.Error("update: undo failed", "error", uerr)
		}
		return errors.Join(errUpdateRestart, err)
	}
	return nil
}

// requestRestart hands the restart to main (non-blocking: one pending restart is enough).
func requestRestart(req RestartRequest) {
	select {
	case RestartCh <- req:
	default:
	}
}

// lastBinaryBackup is set by replaceBinary (under updateMu) so the web update knows where the
// old binary went: on macOS os.Executable() keeps reporting the original path.
var lastBinaryBackup string

// updateExePath is the installed binary the update replaced. Swappable in tests (never the test binary).
var updateExePath = func() string {
	exe, _ := os.Executable()
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		exe = r
	}
	return BinaryFromBackupPath(exe)
}

func (m *ManagementServer) guardSpec(want string) updateGuardSpec {
	exe := updateExePath()
	sock, _ := activeAPISocket.Load().(string)
	spec := updateGuardSpec{
		SocketPath: sock,
		Want:       want,
		Old:        CurrentVersion,
		Exe:        exe,
		Backup:     lastBinaryBackup,
		PID:        os.Getpid(),
		Args:       os.Args[1:],
		StateDir:   UpdateStateDir,
		TimeoutSec: int(UpdateGuardTimeout / time.Second),
		GraceSec:   int(updateGuardGrace / time.Second),
	}
	if m != nil {
		host := m.host
		if host == "" || host == "0.0.0.0" || host == "::" {
			host = "127.0.0.1"
		}
		spec.StatusURL = fmt.Sprintf("http://%s/api/v1/status", joinHostPort(host, m.port))
		spec.Token = m.token
	}
	return spec
}

func joinHostPort(host string, port int) string {
	if strings.Contains(host, ":") {
		return fmt.Sprintf("[%s]:%d", host, port)
	}
	return fmt.Sprintf("%s:%d", host, port)
}
