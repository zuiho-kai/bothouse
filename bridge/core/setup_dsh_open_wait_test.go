package core

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	ccconnect "github.com/chenhg5/cc-connect"
)

// fakeSlowDSH puts a `dsh` on PATH that prints a log line, sleeps, then prints its address (or exits).
func fakeSlowDSH(t *testing.T, script string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("uses a sh script as dsh")
	}
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "dsh"), []byte("#!/bin/sh\n"+script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+"/bin:/usr/bin")
	t.Setenv("HOME", t.TempDir())
	t.Setenv("CONEST_COLLAB_DATA", filepath.Join(t.TempDir(), "collab"))
	old := dshWebOpenWait
	dshWebOpenWait = 200 * time.Millisecond
	t.Cleanup(func() {
		dshWebOpenWait = old
		dshWebMu.Lock()
		if dshWebStarting != nil {
			stopProcess(dshWebStarting.PID)
		}
		dshWebStarting = nil
		dshWebMu.Unlock()
		if w := stateForTest(t); w.PID > 0 {
			stopProcess(w.PID)
		}
	})
}

func stateForTest(t *testing.T) DSHWeb {
	t.Helper()
	var w DSHWeb
	b, err := os.ReadFile(dshWebStatePath())
	if err != nil {
		return w
	}
	_ = json.Unmarshal(b, &w)
	return w
}

// A slow first start has no deadline: open answers "starting" with the elapsed time and the last log
// line, a second open claims the same process, a restarted bothouse claims it from the file, and the
// address is returned once printed.
func TestOpenDSHWebWaitsWhileStarting(t *testing.T) {
	fakeSlowDSH(t, "echo 'installing deps'\nsleep 2\necho 'dsh web: http://127.0.0.1:9/?token=t'\nexec sleep 60\n")
	ctx := context.Background()
	w1, err := openDSHWeb(ctx, t.TempDir())
	if err != nil || !w1.Starting || w1.PID <= 0 || w1.URL != "" {
		t.Fatalf("first open: want starting, got %+v %v", w1, err)
	}
	time.Sleep(500 * time.Millisecond)
	w2, err := openDSHWeb(ctx, t.TempDir())
	if err != nil || !w2.Starting || w2.PID != w1.PID {
		t.Fatalf("second open did not claim the launch: %+v %v (first pid %d)", w2, err, w1.PID)
	}
	if w2.LogTail != "installing deps" || w2.ElapsedSec < 0 {
		t.Fatalf("log tail = %q", w2.LogTail)
	}
	if _, err := os.Stat(dshWebStartingPath()); err != nil {
		t.Fatalf("no starting file: %v", err)
	}
	// a restarted bothouse has no launch in memory: it claims the one in the file
	dshWebMu.Lock()
	dshWebStarting = nil
	dshWebMu.Unlock()
	time.Sleep(2500 * time.Millisecond)
	w3, err := openDSHWeb(ctx, t.TempDir())
	if err != nil || w3.Starting || w3.PID != w1.PID || !strings.HasPrefix(w3.URL, "http://127.0.0.1:9/?token=t") {
		t.Fatalf("want the address of pid %d, got %+v %v", w1.PID, w3, err)
	}
	if _, err := os.Stat(dshWebStartingPath()); !os.IsNotExist(err) {
		t.Fatalf("starting file left behind: %v", err)
	}
	if st := stateForTest(t); st.PID != w1.PID || st.Starting {
		t.Fatalf("state file = %+v", st)
	}
}

// Only an exit fails the start.
func TestOpenDSHWebFailsWhenItExits(t *testing.T) {
	fakeSlowDSH(t, "echo 'boom: plugin crashed'\nsleep 0.5\nexit 3\n")
	ctx := context.Background()
	w, err := openDSHWeb(ctx, t.TempDir())
	for i := 0; err == nil && w.Starting && i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		w, err = openDSHWeb(ctx, t.TempDir())
	}
	if err == nil || !strings.Contains(err.Error(), "exited before printing its address") || !strings.Contains(err.Error(), "boom: plugin crashed") {
		t.Fatalf("want the exit with its log, got %+v %v", w, err)
	}
	if _, err := os.Stat(dshWebStartingPath()); !os.IsNotExist(err) {
		t.Fatalf("starting file left behind: %v", err)
	}
}

// A failed open must not wipe the log: its previous announcement is what takeOverOrphanDSHWeb reads
// when a `dsh web` from an earlier start is still running, and what the panel shows as the last line
// when the new one dies (O_TRUNC used to erase both — 2026-11-05 现场, notes/dsh-bughunt2-B-185-bugs.md 第 3 条).
func TestOpenDSHWebKeepsThePreviousAnnouncementInTheLog(t *testing.T) {
	fakeSlowDSH(t, "sleep 2\necho 'dsh web: http://127.0.0.1:9/?token=t'\nexec sleep 60\n")
	logPath := filepath.Join(filepath.Dir(dshWebStatePath()), "dsh-web.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		t.Fatal(err)
	}
	prev := "dsh web: http://127.0.0.1:45999/?token=previous\n"
	if err := os.WriteFile(logPath, []byte(prev), 0o600); err != nil {
		t.Fatal(err)
	}
	w, err := openDSHWeb(context.Background(), t.TempDir())
	if err != nil || !w.Starting {
		t.Fatalf("want starting, got %+v %v", w, err)
	}
	b, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "token=previous") {
		t.Fatalf("the previous announcement was truncated: %q", b)
	}
}

// fakeOwnDSHHost starts a process whose command line says it is a DSH host of this bridge: a `dsh`
// wrapper script that execs bin, started with this bridge's data directory. Since #1255 the recorded
// pid is stopped only when it is provably such a host (dshWebPIDOwned), so a test that needs "the old
// host gets stopped for the import" has to start one instead of a bare /bin/sleep.
func fakeOwnDSHHost(t *testing.T, bin string, args ...string) *exec.Cmd {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("uses a sh wrapper as dsh")
	}
	if _, err := os.Stat(bin); err != nil {
		t.Skip("no "+bin+":", err)
	}
	dir := t.TempDir()
	dst := filepath.Join(dir, "dsh")
	script := "#!/bin/sh\nexec " + bin
	for _, a := range args {
		script += " " + a
	}
	if err := os.WriteFile(dst, []byte(script+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(dst, args...)
	if own := dshWebOwnDataDir(); own != "" {
		cmd.Env = append(os.Environ(), ccconnect.DataDirEnv+"="+own)
	}
	if err := cmd.Start(); err != nil {
		t.Skip("cannot start the stand-in host:", err)
	}
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	return cmd
}
