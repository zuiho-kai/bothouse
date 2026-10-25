package core

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeClock makes the guard's waits instant.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time        { return c.t }
func (c *fakeClock) sleep(d time.Duration) { c.t = c.t.Add(d) }

func guardFixture(t *testing.T) updateGuardSpec {
	t.Helper()
	dir := t.TempDir()
	exe := filepath.Join(dir, "bothouse")
	backup := exe + ".old-1"
	if err := os.WriteFile(exe, []byte("NEW"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(backup, []byte("OLD"), 0o755); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(dir, "data")
	_ = os.MkdirAll(state, 0o755)
	_ = os.WriteFile(filepath.Join(state, updatePendingFile), []byte("{}"), 0o600)
	spec := updateGuardSpec{Want: "v0.1.5", Old: "v0.1.4", Exe: exe, Backup: backup, StateDir: state,
		TimeoutSec: 90, GraceSec: 15, Args: []string{"--config", "x"}}
	if err := writeUpdateMarker(spec, 0); err != nil {
		t.Fatal(err)
	}
	return spec
}

func readFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestUpdateGuard_NewVersionServes(t *testing.T) {
	spec := guardFixture(t)
	clk := &fakeClock{t: time.Unix(0, 0)}
	calls := 0
	r := runUpdateGuard(spec, guardOps{now: clk.now, sleep: clk.sleep,
		probe: func(updateGuardSpec) string {
			calls++
			if calls < 3 {
				return "" // still starting
			}
			return "0.1.5"
		},
		kill:  func(int) { t.Fatal("must not kill a healthy new version") },
		start: func(string, []string) error { t.Fatal("must not start old"); return nil },
	})
	if r.Status != "ok" || readFile(t, spec.Exe) != "NEW" {
		t.Fatalf("got %+v exe=%s", r, readFile(t, spec.Exe))
	}
	if ReadUpdateResult(spec.StateDir).Status != "ok" {
		t.Fatal("result not written")
	}
	if _, err := os.Stat(filepath.Join(spec.StateDir, updatePendingFile)); !os.IsNotExist(err) {
		t.Fatal("pending marker left behind")
	}
}

func TestUpdateGuard_TimeoutRollsBackAndStartsOld(t *testing.T) {
	spec := guardFixture(t)
	_ = os.WriteFile(filepath.Join(spec.StateDir, updateNewPIDFile), []byte("4242"), 0o644)
	clk := &fakeClock{t: time.Unix(0, 0)}
	var killed int
	var started string
	var startedArgs []string
	r := runUpdateGuard(spec, guardOps{now: clk.now, sleep: clk.sleep,
		probe: func(updateGuardSpec) string { return "" }, // new version never answers, nobody restarts
		kill:  func(pid int) { killed = pid },
		start: func(exe string, args []string) error { started, startedArgs = exe, args; return nil },
	})
	if r.Status != "rolled_back" || r.From != "v0.1.4" || r.To != "v0.1.5" {
		t.Fatalf("got %+v", r)
	}
	if killed != 4242 {
		t.Fatalf("killed %d, want the new process 4242", killed)
	}
	if readFile(t, spec.Exe) != "OLD" {
		t.Fatal("old binary not put back")
	}
	if started != spec.Exe || fmt.Sprint(startedArgs) != fmt.Sprint(spec.Args) {
		t.Fatalf("started %q %v", started, startedArgs)
	}
	if lr := ReadUpdateResult(spec.StateDir); lr == nil || lr.Status != "rolled_back" {
		t.Fatalf("result %+v", lr)
	}
	// the failed new binary is kept aside, not in place
	m, _ := filepath.Glob(spec.Exe + ".failed-*")
	if len(m) != 1 || readFile(t, m[0]) != "NEW" {
		t.Fatalf("failed binary: %v", m)
	}
	// the wait really lasted the timeout (+grace), not less
	if got := clk.t.Sub(time.Unix(0, 0)); got < 105*time.Second {
		t.Fatalf("waited only %v", got)
	}
}

func TestUpdateGuard_WrongVersionCountsAsFailure(t *testing.T) {
	spec := guardFixture(t)
	clk := &fakeClock{t: time.Unix(0, 0)}
	phase := "new"
	started := false
	r := runUpdateGuard(spec, guardOps{now: clk.now, sleep: clk.sleep,
		probe: func(updateGuardSpec) string {
			if phase == "new" {
				return "v0.1.4" // something answers, but not the new version
			}
			return "v0.1.4"
		},
		kill:  func(int) { phase = "old" },
		start: func(string, []string) error { started = true; return nil },
	})
	if r.Status != "rolled_back" || readFile(t, spec.Exe) != "OLD" {
		t.Fatalf("got %+v", r)
	}
	if started {
		t.Fatal("old version came back by itself (supervisor); must not start a second copy")
	}
}

func TestUpdateGuard_RestoreFailsReported(t *testing.T) {
	spec := guardFixture(t)
	_ = os.Remove(spec.Backup) // backup gone
	clk := &fakeClock{t: time.Unix(0, 0)}
	r := runUpdateGuard(spec, guardOps{now: clk.now, sleep: clk.sleep,
		probe: func(updateGuardSpec) string { return "" }, kill: func(int) {},
		start: func(string, []string) error { return nil }})
	if r.Status != "rollback_failed" || readFile(t, spec.Exe) != "NEW" {
		t.Fatalf("got %+v exe=%s", r, readFile(t, spec.Exe))
	}
}

func TestProbeStatusVersion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		mgmtJSON(w, http.StatusOK, map[string]any{"version": "v0.1.5"})
	}))
	defer srv.Close()
	if v := probeStatusVersion(updateGuardSpec{StatusURL: srv.URL, Token: "tok"}); v != "v0.1.5" {
		t.Fatalf("got %q", v)
	}
	if v := probeStatusVersion(updateGuardSpec{StatusURL: srv.URL, Token: "bad"}); v != "" {
		t.Fatalf("unauthorized should be empty, got %q", v)
	}
}

func TestUpdateFailReason(t *testing.T) {
	cases := map[string]error{
		"permission": fmt.Errorf("backup old binary: %w", &os.PathError{Op: "rename", Path: "/Applications/x", Err: os.ErrPermission}),
		"checksum":   VerifyReleaseChecksum([]byte("a"), []byte("00 f\n"), "f"),
		"download":   fmt.Errorf("%w from all sources: %w", ErrUpdateDownload, errors.New("HTTP 404")),
		"restart":    errors.Join(errUpdateRestart, errors.New("exec format error")),
		"other":      errors.New("extract binary: bothouse binary not found"),
	}
	for want, err := range cases {
		if got := updateFailReason(err); got != want {
			t.Errorf("%v → %s, want %s", err, got, want)
		}
	}
}

func TestHandleUpdateApply_GuardStartFailsUndoes(t *testing.T) {
	spec := guardFixture(t)
	withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
	oldStart, oldBackup, oldDir, oldExe := startUpdateGuard, lastBinaryBackup, UpdateStateDir, updateExePath
	t.Cleanup(func() {
		startUpdateGuard, lastBinaryBackup, UpdateStateDir, updateExePath = oldStart, oldBackup, oldDir, oldExe
	})
	lastBinaryBackup = spec.Backup
	updateExePath = func() string { return spec.Exe }
	var got updateGuardSpec
	startUpdateGuard = func(s updateGuardSpec) error { got = s; return errors.New("fork failed") }
	_, d := callMgmt(t, (&ManagementServer{port: 9820}).handleUpdateApply, http.MethodPost)
	if d["status"] != "failed" || d["reason"] != "restart" {
		t.Fatalf("got %v", d)
	}
	if readFile(t, spec.Exe) != "OLD" {
		t.Fatal("update not undone after the self-check could not start")
	}
	if got.Want != "v0.1.5" || got.Backup != spec.Backup || got.StatusURL != "http://127.0.0.1:9820/api/v1/status" {
		t.Fatalf("spec %+v", got)
	}
}

func TestUndoReplace(t *testing.T) {
	spec := guardFixture(t)
	if err := undoReplace(spec); err != nil {
		t.Fatal(err)
	}
	if readFile(t, spec.Exe) != "OLD" {
		t.Fatal("not restored")
	}
}

func TestHandleUpdate_ShowsRollback(t *testing.T) {
	withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
	oldDir := UpdateStateDir
	t.Cleanup(func() { UpdateStateDir = oldDir })
	UpdateStateDir = t.TempDir()
	writeUpdateResult(UpdateStateDir, UpdateResult{Status: "rolled_back", From: "v0.1.4", To: "v0.1.5"})
	_, d := callMgmt(t, (&ManagementServer{}).handleUpdate, http.MethodGet)
	lr, _ := d["last_result"].(map[string]any)
	if lr["status"] != "rolled_back" || lr["from"] != "v0.1.4" {
		t.Fatalf("got %v", d)
	}
	callMgmt(t, (&ManagementServer{}).handleUpdateAck, http.MethodPost)
	_, d = callMgmt(t, (&ManagementServer{}).handleUpdate, http.MethodGet)
	if _, ok := d["last_result"]; ok {
		t.Fatal("ack did not clear")
	}
}

// armFixture stubs everything an update entry touches and records the guard it starts.
// Never starts a real guard, never touches the test binary.
func armFixture(t *testing.T, startErr error) (updateGuardSpec, *[]updateGuardSpec) {
	t.Helper()
	spec := guardFixture(t)
	withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
	oldStart, oldBackup, oldExe, oldMgmt := startUpdateGuard, lastBinaryBackup, updateExePath, activeMgmt.Load()
	t.Cleanup(func() {
		startUpdateGuard, lastBinaryBackup, updateExePath = oldStart, oldBackup, oldExe
		activeMgmt.Store(oldMgmt)
		for len(RestartCh) > 0 {
			<-RestartCh
		}
	})
	lastBinaryBackup = spec.Backup
	updateExePath = func() string { return spec.Exe }
	activeMgmt.Store(&ManagementServer{port: 9820})
	got := &[]updateGuardSpec{}
	startUpdateGuard = func(s updateGuardSpec) error { *got = append(*got, s); return startErr }
	return spec, got
}

func takeRestart(t *testing.T) RestartRequest {
	t.Helper()
	select {
	case r := <-RestartCh:
		return r
	default:
		t.Fatal("no restart requested")
		return RestartRequest{}
	}
}

func TestUpdateEntry_WebArmsGuard(t *testing.T) {
	_, got := armFixture(t, nil)
	if _, d := callMgmt(t, (&ManagementServer{port: 9820}).handleUpdateApply, http.MethodPost); d["status"] != "restarting" {
		t.Fatalf("got %v", d)
	}
	if len(*got) != 1 || (*got)[0].Want != "v0.1.5" || (*got)[0].Notify != nil {
		t.Fatalf("guard %+v", *got)
	}
	takeRestart(t)
}

func TestUpdateEntry_ChatUpgradeArmsGuardWithNotify(t *testing.T) {
	_, got := armFixture(t, nil)
	p := &stubPlatformEngine{n: "discord"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.cmdUpgradeConfirm(p, &Message{SessionKey: "discord:c1:u1", ReplyCtx: "rc"})
	if len(*got) != 1 || (*got)[0].Want != "v0.1.5" || (*got)[0].StatusURL != "http://127.0.0.1:9820/api/v1/status" {
		t.Fatalf("guard %+v", *got)
	}
	if n := (*got)[0].Notify; n == nil || n.SessionKey != "discord:c1:u1" || n.Platform != "discord" {
		t.Fatalf("notify %+v", (*got)[0].Notify)
	}
	if r := takeRestart(t); r.SessionKey != "discord:c1:u1" {
		t.Fatalf("restart %+v", r)
	}
}

func TestUpdateEntry_ChatUpgradeGuardFailsUndoesAndSays(t *testing.T) {
	spec, _ := armFixture(t, errors.New("fork failed"))
	p := &stubPlatformEngine{n: "discord"}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.cmdUpgradeConfirm(p, &Message{SessionKey: "discord:c1:u1", ReplyCtx: "rc"})
	if readFile(t, spec.Exe) != "OLD" {
		t.Fatal("update not undone")
	}
	sent := strings.Join(p.getSent(), "\n")
	if !strings.Contains(sent, "已退回 v0.1.4") {
		t.Fatalf("chat not told: %q", sent)
	}
	if len(RestartCh) != 0 {
		t.Fatal("restarted although the self-check could not start")
	}
}

func TestUpdateEntry_SocketUpdateArmsGuard(t *testing.T) {
	spec, got := armFixture(t, nil)
	rec := httptest.NewRecorder()
	handleSocketUpdate(rec, socketUpdateRequest(spec.Exe, "v0.1.5"))
	if !strings.Contains(rec.Body.String(), `"restarting"`) {
		t.Fatalf("reply %s", rec.Body.String())
	}
	if len(*got) != 1 || (*got)[0].Want != "v0.1.5" {
		t.Fatalf("guard %+v", *got)
	}
	takeRestart(t)
}

// A rolled-back chat update leaves the plain-words note for the old binary to send.
func TestUpdateGuard_RollbackTellsChat(t *testing.T) {
	spec := guardFixture(t)
	spec.Notify = &RestartRequest{SessionKey: "discord:c1:u1", Platform: "discord"}
	clk := &fakeClock{t: time.Unix(0, 0)}
	runUpdateGuard(spec, guardOps{now: clk.now, sleep: clk.sleep,
		probe: func(updateGuardSpec) string { return "" },
		kill:  func(int) {},
		start: func(string, []string) error { return nil },
	})
	n := ConsumeRestartNotify(spec.StateDir)
	if n == nil || n.SessionKey != "discord:c1:u1" || n.Text != "新版 v0.1.5 没能启动，已退回 v0.1.4" {
		t.Fatalf("notify %+v", n)
	}
}

// Management off: the update still gets a self-check, probing the local socket's /version.
func TestUpdateEntry_NoManagementUsesSocket(t *testing.T) {
	spec, got := armFixture(t, nil)
	activeMgmt.Store(nil)
	oldSock, _ := activeAPISocket.Load().(string)
	t.Cleanup(func() { activeAPISocket.Store(oldSock) })
	activeAPISocket.Store("/tmp/bh-test/api.sock")
	rec := httptest.NewRecorder()
	handleSocketUpdate(rec, socketUpdateRequest(spec.Exe, "v0.1.5"))
	if len(*got) != 1 || (*got)[0].SocketPath != "/tmp/bh-test/api.sock" || (*got)[0].StatusURL != "" {
		t.Fatalf("guard %+v", *got)
	}
	takeRestart(t)
}

// Neither management nor socket: undo the replacement, do not restart unguarded.
func TestUpdateEntry_NoProbeUndoes(t *testing.T) {
	spec, got := armFixture(t, nil)
	activeMgmt.Store(nil)
	oldSock, _ := activeAPISocket.Load().(string)
	t.Cleanup(func() { activeAPISocket.Store(oldSock) })
	activeAPISocket.Store("")
	rec := httptest.NewRecorder()
	handleSocketUpdate(rec, socketUpdateRequest(spec.Exe, "v0.1.5"))
	if len(*got) != 0 || len(RestartCh) != 0 || readFile(t, spec.Exe) != "OLD" {
		t.Fatalf("restarted unguarded: guards=%d restarts=%d", len(*got), len(RestartCh))
	}
}

func TestProbeSocketVersion(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "bhver")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock := filepath.Join(dir, "api.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(handleSocketVersion)}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	old := CurrentVersion
	t.Cleanup(func() { CurrentVersion = old })
	CurrentVersion = "v0.1.5"
	if v := probeStatusVersion(updateGuardSpec{SocketPath: sock}); v != "v0.1.5" {
		t.Fatalf("got %q", v)
	}
}

// systemd kills the guard together with the new process: the old binary must already be back
// in place when the guard stops the new one.
func TestUpdateGuard_SwapsBeforeKill(t *testing.T) {
	spec := guardFixture(t)
	spec.PID = 999999
	clk := &fakeClock{t: time.Unix(0, 0)}
	var atKill string
	runUpdateGuard(spec, guardOps{now: clk.now, sleep: clk.sleep,
		probe: func(updateGuardSpec) string { return "" },
		kill:  func(int) { atKill = readFile(t, spec.Exe) },
		start: func(string, []string) error { return nil },
	})
	if atKill != "OLD" {
		t.Fatalf("exe at kill time = %q, want OLD", atKill)
	}
}
