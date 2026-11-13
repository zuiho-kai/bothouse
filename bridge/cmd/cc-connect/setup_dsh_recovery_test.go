package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/core"
	"github.com/chenhg5/cc-connect/tests/testutil"
)

// #1728: the production setup-only loop must recover a previously opened host without
// another POST /setup/dsh/open. Only dsh itself is a stand-in; startup, state files,
// the detached process, its exit, and the setup server lifecycle are real.
func TestSetupOnlyRecoversExitedDSHHost(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a POSIX dsh stand-in")
	}
	home := t.TempDir()
	testutil.SetHome(t, home)
	t.Setenv(ccconnect.DataDirEnv, filepath.Join(home, "data"))
	bin := t.TempDir()
	script := "#!/bin/sh\necho 'dsh web: http://127.0.0.1:0/?token=fixture'\nexec /bin/sleep 60\n"
	if err := os.WriteFile(filepath.Join(bin, "dsh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	state := filepath.Join(home, ".bothouse", "dsh-web.json")
	readHost := func() core.DSHWeb {
		var web core.DSHWeb
		b, err := os.ReadFile(state)
		if err == nil {
			_ = json.Unmarshal(b, &web)
		}
		return web
	}
	stopHost := func(pid int) {
		if pid > 0 {
			p, err := os.FindProcess(pid)
			if err == nil {
				_ = p.Kill()
			}
		}
	}
	// The bridge deliberately leaves a detached host alive on shutdown; clean up only
	// the PIDs this isolated test started, after its supervisor has stopped.
	t.Cleanup(func() { stopHost(readHost().PID) })
	_, _, stop := setupModeServer(t)
	t.Cleanup(stop)
	web, err := core.OpenDSHWeb(context.Background())
	if err != nil || web.Starting || web.PID <= 0 {
		t.Fatalf("initial open: %+v, %v", web, err)
	}
	stopHost(web.PID)
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		if next := readHost(); next.PID > 0 && next.PID != web.PID {
			if next.URL == "" || next.Starting {
				t.Fatalf("replacement not ready: %+v", next)
			}
			t.Logf("setup-only recovered exited host %d as %d without a panel request", web.PID, next.PID)
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal(fmt.Sprintf("setup-only bridge did not restart exited DSH host %d without a panel request; state=%+v", web.PID, readHost()))
}
