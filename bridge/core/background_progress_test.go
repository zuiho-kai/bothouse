package core

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func trackedRunFixture(t *testing.T, e *Engine, updated time.Time) string {
	t.Helper()
	dir := filepath.Join(e.backgroundRunsDir(), "tracked")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{"pid": strconv.Itoa(os.Getpid()), "session": "discord:ws1", "log": ""} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(filepath.Join(dir, "log"), updated, updated); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestTrackedBackgroundProgressRequiresRecentOutput(t *testing.T) {
	for _, renewed := range []int{0, watchMaxBackgroundRenew} {
		for _, active := range []bool{false, true} {
			t.Run(strconv.Itoa(renewed)+"/"+strconv.FormatBool(active), func(t *testing.T) {
				e, p, w, h := watchFixture(t, "", "tracked command")
				updated := time.Now().Add(-2 * watchCheckAfter())
				if active {
					updated = time.Now()
				}
				trackedRunFixture(t, e, updated)
				// Fresh output must remain progress beyond the native-task renewal cap.
				h.Renewed = renewed
				w.updateHandoff("discord:ws1", h, func(row *TeamHandoff) { row.Renewed = h.Renewed })
				w.tick(h.Due)
				got := handoffsOf(e, "discord:ws1")[0]
				if got.Nudged == active {
					t.Fatalf("active=%v: nudged=%v renewed=%d messages=%v", active, got.Nudged, got.Renewed, p.out)
				}
			})
		}
	}
}

func TestTrackedBackgroundIdleWakeRequiresRecentOutput(t *testing.T) {
	e, _, _, h := watchFixture(t, "", "tracked command")
	dir := trackedRunFixture(t, e, time.Now().Add(-2*watchCheckAfter()))
	h.Idle.Ended = time.Now()
	e.updateIdle(idleAssignment{"discord:ws1", h, false}, func(row *TeamHandoff) { row.Idle = h.Idle })
	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Wakes != 1 {
		t.Fatalf("silent live command prevented idle wake: %+v", got.Idle)
	}
	if err := os.WriteFile(filepath.Join(dir, "log"), []byte("progress\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	e.fireIdleWake(idleAssignment{"discord:ws1", got, false})
	if after := handoffsOf(e, "discord:ws1")[0]; after.Idle.Wakes != got.Idle.Wakes {
		t.Fatalf("new output did not suppress idle wake: %+v", after.Idle)
	}
}
