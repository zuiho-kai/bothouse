package core

import (
	"testing"
	"time"
)

// idleWatchFixture: an engine with a disk-backed workspace store, so a test can seed the watches
// watchTurnEnded reads and check what it wrote back.
func idleWatchFixture(t *testing.T) (*Engine, *exitTestPlatform) {
	t.Helper()
	e, _, p := exitFixture(t, nil)
	dir := e.dataDir
	t.Cleanup(func() {
		teamWorkspaceStore.mu.Lock()
		delete(teamWorkspaceStore.cache, teamWorkspacePath(dir))
		teamWorkspaceStore.mu.Unlock()
	})
	return e, p
}

// idleWatchSeed registers an open watch for key; script picks the board-less map (#96's
// "no board number" direct assignments) or the handoff map.
func idleWatchSeed(t *testing.T, e *Engine, key string, script bool, h TeamHandoff) {
	t.Helper()
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)
	if script {
		st.ScriptWatches = map[string][]TeamHandoff{key: {h}}
	} else {
		st.Handoffs = map[string][]TeamHandoff{key: {h}}
	}
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		t.Fatal(err)
	}
}

func idleWatchRows(t *testing.T, e *Engine, key string, script bool) []TeamHandoff {
	t.Helper()
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)
	if script {
		return append([]TeamHandoff(nil), st.ScriptWatches[key]...)
	}
	return append([]TeamHandoff(nil), st.Handoffs[key]...)
}

// A [report] with no board number cannot satisfy the headline check, so it must end its watch
// instead of being treated as a reply still to be repaired: the resend rule only bounces reports
// that name a board item (#96, 11-05: the same board-less report woke the workspace again and
// again).
func TestWatchTurnEnded_BoardlessReportEndsWatch(t *testing.T) {
	const report = "[report] 背景：看门遇到没写任务板编号的交回，已经改成能收口\n\n要你做的：没有"
	for _, script := range []bool{true, false} {
		name := "handoff"
		if script {
			name = "script_watch"
		}
		t.Run(name, func(t *testing.T) {
			e, p := idleWatchFixture(t)
			key := "discord:ws96"
			at := time.Now().Add(-2 * time.Minute)
			idleWatchSeed(t, e, key, script, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "看门死循环"})

			for i := 0; i < 2; i++ { // a resend or a second reply must not open it again
				e.watchTurnEnded(p, key+":u1", report, false, false, false, time.Time{})
				rows := idleWatchRows(t, e, key, script)
				if len(rows) != 1 {
					t.Fatalf("reply %d: rows = %d, want 1", i, len(rows))
				}
				h := rows[0]
				if !h.Idle.Returned {
					t.Fatalf("reply %d: a board-less [report] left the watch open: %+v", i, h.Idle)
				}
				if h.Idle.Wakes != 0 || h.Idle.Reported {
					t.Fatalf("reply %d: the watch kept waking: %+v", i, h.Idle)
				}
			}
		})
	}
}

// A [report] that names a board item whose headline is wrong is still resent, not handed back:
// the workspace can repair that one, and forwardWorkspaceExit is already asking it to.
func TestWatchTurnEnded_ReportWithBoardNumberKeepsResending(t *testing.T) {
	e, p := idleWatchFixture(t)
	key := "discord:ws97"
	at := time.Now().Add(-2 * time.Minute)
	idleWatchSeed(t, e, key, true, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "带板号的交回"})

	e.watchTurnEnded(p, key+":u1", "[report] #77 背景：这件活做完了\n\n要你做的：没有", false, false, false, time.Time{})

	rows := idleWatchRows(t, e, key, true)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].Idle.Returned {
		t.Fatalf("a report naming #77 with a headline to repair was taken as handed back: %+v", rows[0].Idle)
	}
}

// A watch that already gave up (two unanswered wakes, or the failure limit) stays given up when a
// later turn happens to run tools: clearing the counters there revived it, so the same assignment
// woke and escalated again and again (#96).
func TestWatchTurnEnded_WorkDoesNotReviveReportedWatch(t *testing.T) {
	e, p := idleWatchFixture(t)
	key := "discord:ws98"
	at := time.Now().Add(-2 * time.Minute)
	idleWatchSeed(t, e, key, true, TeamHandoff{
		Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "已经升级主角色",
		Idle: watchIdleState{Ended: at, Wakes: 2, Reported: true},
	})

	e.watchTurnEnded(p, key+":u1", "接着做，还在跑，这里先说一声进展", true, false, false, time.Time{})

	rows := idleWatchRows(t, e, key, true)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	h := rows[0]
	if !h.Idle.Reported {
		t.Fatalf("a reported watch lost its reported mark after a turn that ran tools: %+v", h.Idle)
	}
	if h.Idle.Wakes != 2 {
		t.Fatalf("wakes = %d, want 2 (kept for the escalation already made)", h.Idle.Wakes)
	}

	// A watch that is still working keeps the old reset: progress clears the wake count.
	e2, p2 := idleWatchFixture(t)
	idleWatchSeed(t, e2, key, true, TeamHandoff{
		Chat: key, At: at, Due: at.Add(time.Minute), Owner: e2.name, Title: "还在做",
		Idle: watchIdleState{Ended: at, Wakes: 1},
	})
	e2.watchTurnEnded(p2, key+":u1", "接着做，还在跑", true, false, false, time.Time{})
	if got := idleWatchRows(t, e2, key, true)[0].Idle.Wakes; got != 0 {
		t.Fatalf("wakes = %d after real work, want 0", got)
	}
}
