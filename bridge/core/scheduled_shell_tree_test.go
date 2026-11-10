package core

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// This helper keeps stdout and a socket open in a grandchild, as ingest keeps its
// lock while a model is running. Killing only the shell must fail this test.
func TestScheduledShellTreeHelper(t *testing.T) {
	mode := os.Getenv("BOTHOUSE_SHELL_TREE_HELPER")
	if mode == "" {
		return
	}
	if mode == "parent" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestScheduledShellTreeHelper$")
		cmd.Env = append(os.Environ(), "BOTHOUSE_SHELL_TREE_HELPER=child")
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		_ = cmd.Run()
		return
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	unlock, err := lockBoardFile(os.Getenv("BOTHOUSE_SHELL_TREE_FILE") + ".lock")
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	data, _ := json.Marshal(struct {
		PID  int
		Addr string
	}{os.Getpid(), ln.Addr().String()})
	path := os.Getenv("BOTHOUSE_SHELL_TREE_FILE")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	until := time.Now().Add(10 * time.Second)
	for time.Now().Before(until) {
		f, err := os.OpenFile(path+".writes", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.WriteString("x")
		_ = f.Close()
		time.Sleep(10 * time.Millisecond)
	}
}

func TestScheduledShellTimeoutStopsDescendants(t *testing.T) {
	old := testHookScheduledShellTimeout
	testHookScheduledShellTimeout = func(time.Duration) time.Duration { return 500 * time.Millisecond }
	defer func() { testHookScheduledShellTimeout = old }()
	for _, kind := range []string{"cron", "timer"} {
		t.Run(kind, func(t *testing.T) {
			e := newTestEngine()
			defer e.cancel()
			p := &stubPlatformEngine{n: "test"}
			dir, err := os.MkdirTemp("", "scheduled-tree-")
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dir, "child.json")
			t.Setenv("BOTHOUSE_SHELL_TREE_FILE", path)
			t.Setenv("BOTHOUSE_SHELL_TREE_HELPER", "parent")
			command := fmt.Sprintf("%q -test.run=^TestScheduledShellTreeHelper$", os.Args[0])
			if runtime.GOOS == "windows" {
				command = "& '" + strings.ReplaceAll(os.Args[0], "'", "''") + "' '-test.run=^TestScheduledShellTreeHelper$'"
			}
			started := time.Now()
			if kind == "cron" {
				err = e.executeCronShell(p, nil, &CronJob{Exec: command, WorkDir: dir})
			} else {
				err = e.executeTimerShell(p, nil, &TimerJob{Exec: command, WorkDir: dir})
			}
			if err == nil || !strings.Contains(err.Error(), "timed out") {
				t.Fatalf("expected timeout, got %v; notices: %v", err, p.getSent())
			}
			var child struct {
				PID  int
				Addr string
			}
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatalf("helper did not start: %v; notices: %v", readErr, p.getSent())
			}
			if err := json.Unmarshal(data, &child); err != nil {
				t.Fatal(err)
			}
			// On the red run, clean up only the known fixture process.
			defer stopProcess(child.PID)
			// Windows taskkill took 3.75s on the real runner; this still must
			// return before the helper's own 10s lifetime, without its cooperation.
			if elapsed := time.Since(started); elapsed > 5*time.Second {
				t.Errorf("cancel waited %s for descendant to exit on its own", elapsed)
			}
			conn, dialErr := net.DialTimeout("tcp", child.Addr, 100*time.Millisecond)
			if dialErr == nil {
				conn.Close()
				t.Error("descendant still owns its socket after timeout")
			}
			before, err := os.Stat(path + ".writes")
			if err != nil {
				t.Fatal(err)
			}
			time.Sleep(50 * time.Millisecond)
			after, err := os.Stat(path + ".writes")
			if err != nil {
				t.Fatal(err)
			}
			if before.Size() != after.Size() {
				t.Error("descendant keeps writing after timeout")
			}
			unlock, err := lockBoardFile(path + ".lock")
			if err != nil {
				t.Fatalf("next round cannot acquire the descendant's file lock: %v", err)
			}
			unlock()
		})
	}
}
