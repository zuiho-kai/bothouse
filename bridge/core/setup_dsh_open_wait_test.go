package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
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
