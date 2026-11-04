package core

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.b.Write(p) }
func (s *syncBuf) String() string              { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

// 2026-11-03: the shared watch loop stalled after 23:35 and the hourly release never ran
// again until a restart. The release runs on its own loop: a workspace whose task is no
// longer live on the board is freed even while the main loop is stuck.
func TestSweepLoopFreesWhileMainLoopStalled(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	team := t.TempDir()
	e.SetTeam(team, "橘", true)
	if err := os.WriteFile(filepath.Join(team, teamTaskBoardFile), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	w := newHandoffWatch(e)
	later := time.Now().Add(2 * teamWorkspaceReconcileEvery)
	w.now = func() time.Time { return later }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.sweepLoop(ctx) // the main loop never runs here

	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, owned := e.WorkspaceParent("ws1"); !owned {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("workspace still owned after the sweep")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// The stall is reported once per stall, stacks in their own file under <data>/logs, and the
// log line carries only the path.
func TestCheckStallWritesStacksFileOnce(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	var logs syncBuf
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(prev)
	w := newHandoffWatch(e)
	start := time.Now()
	w.beat.Store(start.UnixNano())
	if got := w.checkStall(start.Add(watchStallAfter-time.Minute), 0); got != 0 {
		t.Fatal("reported before the threshold")
	}
	now := start.Add(watchStallAfter + time.Minute)
	reported := w.checkStall(now, 0)
	if reported != start.UnixNano() {
		t.Fatal("stall not reported")
	}
	w.checkStall(now.Add(watchStallCheck), reported)
	out := logs.String()
	if n := strings.Count(out, "main loop stalled"); n != 1 {
		t.Fatalf("reported %d times, want once:\n%s", n, out)
	}
	path := filepath.Join(e.dataDir, "logs", "watch-stall-"+now.Format("20060102-150405")+".txt")
	b, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(b), "goroutine") {
		t.Fatalf("stacks file %s: %v", path, err)
	}
	if strings.Contains(out, "goroutine ") || !strings.Contains(out, path) {
		t.Fatalf("log must carry the path, not the stacks:\n%.500s", out)
	}
}
