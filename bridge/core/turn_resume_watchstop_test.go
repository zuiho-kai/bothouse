package core

import (
	"testing"
	"time"
)

// A bridge restart must not resume an assignment the user stopped (2026-11-01: a stopped
// review came back as "bridge restart interrupted the last turn, continuing").
func TestTurnResume_DropsStoppedWatch(t *testing.T) {
	dir := t.TempDir()
	t.Cleanup(func() {
		teamWorkspaceStore.mu.Lock()
		delete(teamWorkspaceStore.cache, teamWorkspacePath(dir))
		teamWorkspaceStore.mu.Unlock()
	})
	e := newTestEngine()
	e.dataDir = dir
	start := time.Now().Add(-10 * time.Minute)
	key := "discord:100"
	st := &teamWorkspaceState{ScriptWatches: map[string][]TeamHandoff{
		key: {
			{Owner: "<@9>", Sender: "lead", Title: "review the diagram", At: start.Add(-time.Hour), Closed: start.Add(time.Minute)},
			{Owner: "<@9>", Sender: "lead", Title: "gave up task", At: start.Add(-time.Hour), Idle: watchIdleState{Reported: true, Ended: start.Add(-2 * time.Hour)}},
		},
	}}
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]TurnJournalEntry{
		"wake":   {TurnID: "wake", InteractiveKey: key + ":u", StartedAt: start, LastUserMessage: "<@9> 接着做 review the diagram，做完交回"},
		"gaveup": {TurnID: "gaveup", InteractiveKey: key + ":u", StartedAt: start, LastUserMessage: "接着做 gave up task"},
		"other":  {TurnID: "other", InteractiveKey: "discord:200:u", StartedAt: start, LastUserMessage: "接着做 review the diagram"},
		"fresh":  {TurnID: "fresh", InteractiveKey: key + ":u", StartedAt: start, LastUserMessage: "新的问题"},
	}
	want := map[string]bool{"wake": true, "gaveup": true, "other": false, "fresh": false}
	for name, en := range cases {
		if got := e.watchStoppedFor(en) != ""; got != want[name] {
			t.Errorf("%s: stopped=%v want %v", name, got, want[name])
		}
	}
	plans := planTurnResumes([]TurnJournalEntry{cases["wake"]}, turnResumeEnv{now: time.Now(), startTime: time.Now(), watchStopped: e.watchStoppedFor})
	if len(plans) != 1 || plans[0].action != turnResumeDrop {
		t.Fatalf("plans: %+v", plans)
	}
	// Handed out again: a newer open watch with the same title resumes normally.
	teamWorkspaceStore.mu.Lock()
	live := loadTeamWorkspacesLocked(teamWorkspacePath(dir))
	live.ScriptWatches[key] = append(live.ScriptWatches[key], TeamHandoff{Owner: "<@9>", Sender: "lead", Title: "review the diagram", At: time.Now()})
	teamWorkspaceStore.mu.Unlock()
	if s := e.watchStoppedFor(cases["wake"]); s != "" {
		t.Fatalf("reopened watch still reported stopped: %q", s)
	}
}
