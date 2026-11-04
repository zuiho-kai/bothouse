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
// again until a restart. The release now runs on its own loop: a workspace whose task is no
// longer live on the board is freed even while the main loop is stuck, and the stall is
// logged once with goroutine stacks.
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
	var logs syncBuf
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(prev)

	w := newHandoffWatch(e)
	later := time.Now().Add(2 * teamWorkspaceReconcileEvery)
	w.now = func() time.Time { return later }
	w.beat.Store(time.Now().UnixNano()) // main loop's last iteration began two hours before "now"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.sweepLoop(ctx)

	deadline := time.Now().Add(5 * time.Second)
	for {
		_, owned := e.WorkspaceParent("ws1")
		out := logs.String()
		if !owned && strings.Contains(out, "main loop stalled") && strings.Contains(out, "goroutine") {
			if n := strings.Count(out, "main loop stalled"); n != 1 {
				t.Fatalf("stall reported %d times, want once", n)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("owned=%v after sweep; logs:\n%.2000s", owned, out)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
