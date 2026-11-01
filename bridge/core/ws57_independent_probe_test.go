package core

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestWS57Independent_OldPausedTaskDoesNotPauseNewBoardBinding(t *testing.T) {
	now := time.Date(2026, 11, 1, 19, 0, 0, 0, time.UTC)
	dir := t.TempDir()
	old := TeamHandoff{Chat: "discord:main", Board: 10, Title: "old task", At: now.Add(-24 * time.Hour), Parked: now.Add(-6 * time.Hour)}
	st := teamWorkspaceState{Version: teamWorkspaceStateVersion, Parents: map[string][]TeamWorkspace{}, Handoffs: map[string][]TeamHandoff{"discord:ws": {old}}}
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(teamWorkspacePath(dir), b, 0600); err != nil {
		t.Fatal(err)
	}
	e := &Engine{dataDir: dir}
	p := teamTaskBoardPlacer{handoffOf: e.TeamHandoffOf}
	items := placeTeamTaskBoard(p, []teamTaskBoardItem{{ID: 56, What: "new task", Status: "进行中", WS: "discord:ws", Chat: "discord:main", Bound: now.Format(time.RFC3339Nano)}})
	got, reason := teamTaskBoardStateOf(items[0], now)
	if got != teamTaskRunning {
		t.Fatalf("new task rendered state=%v reason=%q from old task's paused handoff", got, reason)
	}
}

func TestWS57HandoffIdentityAndLifecycle(t *testing.T) {
	bound := time.Date(2026, 11, 1, 19, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name   string
		h      TeamHandoff
		paused string
		want   teamTaskBoardState
	}{
		{"current open", TeamHandoff{Board: 56}, "", teamTaskRunning},
		{"current truly paused", TeamHandoff{Board: 56, Parked: bound.Add(time.Minute)}, "", teamTaskPaused},
		{"unrelated late pause", TeamHandoff{Board: 10, Parked: bound.Add(time.Minute)}, "", teamTaskRunning},
		{"unrelated closed", TeamHandoff{Board: 10, Closed: bound.Add(time.Minute)}, "", teamTaskRunning},
		{"same task rebound after pause", TeamHandoff{Board: 56, Parked: bound.Add(-time.Minute)}, "", teamTaskRunning},
		{"same task rebound after release", TeamHandoff{Board: 56, Closed: bound.Add(-time.Minute)}, "", teamTaskRunning},
		{"legacy matching title pause", TeamHandoff{Title: "new task", Parked: bound.Add(time.Minute)}, "", teamTaskPaused},
		{"legacy different title", TeamHandoff{Title: "old task", Parked: bound.Add(time.Minute)}, "", teamTaskRunning},
		{"legacy untitled pause", TeamHandoff{Parked: bound.Add(time.Minute)}, "", teamTaskPaused},
		{"explicit board pause wins", TeamHandoff{Board: 10}, "11-01 19:00", teamTaskPaused},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := teamTaskBoardPlacer{handoffOf: func(string, string, time.Time) (TeamHandoff, bool) { return tc.h, true }}
			it := teamTaskBoardItem{ID: 56, What: "new task", Status: "进行中", WS: "room:ws", Chat: "room:main", Bound: bound.Format(time.RFC3339Nano), Paused: tc.paused}
			p.place(&it)
			if got, why := teamTaskBoardStateOf(it, bound); got != tc.want {
				t.Fatalf("state=%v reason=%q want=%v", got, why, tc.want)
			}
		})
	}
}

func TestWS57LongClaimTitlePreservesLifecycle(t *testing.T) {
	bound := time.Now()
	what := strings.Repeat("长", 70)
	for _, closed := range []bool{false, true} {
		h := TeamHandoff{Title: string([]rune(what)[:60])}
		if closed {
			h.Closed = bound.Add(time.Minute)
		} else {
			h.Parked = bound.Add(time.Minute)
		}
		p := teamTaskBoardPlacer{handoffOf: func(string, string, time.Time) (TeamHandoff, bool) { return h, true }}
		it := teamTaskBoardItem{ID: 56, What: what, Short: "独立短名", WS: "room:ws", Chat: "room:main", Bound: bound.Format(time.RFC3339Nano)}
		p.place(&it)
		if !it.wsEnded {
			t.Fatal("real claim lifecycle ignored")
		}
	}
}
