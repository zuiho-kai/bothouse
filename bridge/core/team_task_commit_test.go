package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// testLoadTeamWorkspacesLocked: the state of path for a test; a read error fails loudly.
func testLoadTeamWorkspacesLocked(path string) *teamWorkspaceState {
	st, err := loadTeamWorkspacesLocked(path)
	if err != nil {
		panic(err)
	}
	return st
}

// forgetTeamWorkspaceCache makes the next read of e's state come from disk, as after a restart.
func forgetTeamWorkspaceCache(e *Engine) {
	teamWorkspaceStore.mu.Lock()
	delete(teamWorkspaceStore.cache, teamWorkspacePath(e.dataDir))
	delete(teamWorkspaceStore.committed, teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
}

// #715 review ①: only a missing state file is empty. A file that does not parse or cannot be read
// is an error at the read boundary: nothing is cached, nothing is written over it, no workspace
// is reported free and no claim goes through.
func TestTeamWorkspaceStateUnreadableIsNotFree(t *testing.T) {
	now := time.Now()
	dir := t.TempDir()
	e := &Engine{dataDir: dir}
	step := func(ev teamTaskEvent) error {
		teamWorkspaceStore.mu.Lock()
		defer teamWorkspaceStore.mu.Unlock()
		_, err := transitionTeamTaskLocked(dir, ev, now)
		return err
	}
	if err := step(teamTaskEvent{ID: 1, To: TeamTaskDispatched, WS: "discord:ws1"}); err != nil {
		t.Fatalf("first transition on a missing file = %v, want an empty store", err)
	}
	forgetTeamWorkspaceCache(e)
	path := teamWorkspacePath(dir)
	broken := []byte(`{"parents":{"discord:chatA":[{"id":"ws1"}]},"tasks":{"1":{"id":1,"sta`) // cut mid-write
	if err := os.WriteFile(path, broken, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := step(teamTaskEvent{ID: 3, To: TeamTaskDispatched, WS: "discord:ws2"}); err == nil {
		t.Fatal("transition over a state file that does not parse succeeded")
	}
	if _, _, err := e.TeamTask(1); err == nil {
		t.Fatal("TeamTask on an unparseable file reported \"never seen\" instead of an error")
	}
	if !e.workspaceHasOpenHandoff("discord:ws1") {
		t.Fatal("unreadable state reported workspace ws1 as having nothing in work")
	}
	if names := e.TeamIdleWorkspaceNames("discord:chatA"); len(names) != 0 {
		t.Fatalf("unreadable state listed idle workspaces %v", names)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws2", "工作区2", "", "#2", 2); err == nil {
		t.Fatal("claim over an unparseable state file succeeded")
	}
	teamWorkspaceStore.mu.Lock()
	_, cached := teamWorkspaceStore.cache[path]
	teamWorkspaceStore.mu.Unlock()
	if cached {
		t.Fatal("an unreadable state file was cached")
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, broken) {
		t.Fatalf("unparseable state file was rewritten:\n%s", got)
	}

	// A read error other than "does not exist": the path is a directory.
	dir2 := t.TempDir()
	if err := os.Mkdir(teamWorkspacePath(dir2), 0o755); err != nil {
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Lock()
	_, err := transitionTeamTaskLocked(dir2, teamTaskEvent{ID: 1, To: TeamTaskDispatched, WS: "discord:ws1"}, now)
	teamWorkspaceStore.mu.Unlock()
	if err == nil {
		t.Fatal("transition over an unreadable state file succeeded")
	}
}

// blockWorkspaceSave makes the next save of the state file fail (its path becomes a non-empty
// directory, so the atomic rename fails and the file cannot be read either) and returns a
// function that puts the old file back.
func blockWorkspaceSave(t *testing.T, e *Engine) (restore func()) {
	t.Helper()
	path := teamWorkspacePath(e.dataDir)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	inner := filepath.Join(path, "keep")
	if err := os.WriteFile(inner, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	return func() {
		if err := os.Remove(inner); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, before, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// #715 review ① chain: a park whose save fails does not succeed, does not free the workspace and
// does not stop the turn — and while the file still cannot be read, every query answers from the
// last committed state (owned, task in work), not from an empty one.
func TestParkFailedSaveKeepsCommittedStateWhileFileUnreadable(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#677", 677); err != nil {
		t.Fatal(err)
	}
	running := &cancelCountSession{events: make(chan Event, 1)}
	e.interactiveMu.Lock()
	e.interactiveStates["discord:ws1:u1"] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()
	h := handoffsOf(e, "discord:ws1")[0]

	restore := blockWorkspaceSave(t, e)
	if freed, err := e.ParkTeamWorkspaceWhy("discord:ws1", h.Chat, h.At, "watch: no progress", true); err == nil || freed {
		t.Fatalf("park with a failing save = %v, %v; want an error, workspace kept", freed, err)
	}
	// Before the file is put back (#715: the old code dropped the cache here and read "no owner").
	assertStillInWork(t, e, running, 677)
	if names := e.TeamIdleWorkspaceNames("discord:chatA"); len(names) != 0 {
		t.Fatalf("workspace listed idle after a failed park: %v", names)
	}
	restore()
	forgetTeamWorkspaceCache(e)
	assertStillInWork(t, e, running, 677)

	if freed, err := e.ParkTeamWorkspaceWhy("discord:ws1", h.Chat, h.At, "watch: no progress", true); err != nil || !freed {
		t.Fatalf("park after the file recovered = %v, %v", freed, err)
	}
	forgetTeamWorkspaceCache(e)
	if task, _, _ := e.TeamTask(677); task.State != TeamTaskPaused {
		t.Fatalf("task #677 = %+v after the park, want paused", task)
	}
	if _, ok := e.WorkspaceParent("discord:ws1"); ok {
		t.Fatal("workspace still owned after a committed park")
	}
}

// assertStillInWork: nothing of a refused park leaked — handoff open, workspace owned, turn not
// stopped, task in work there.
func assertStillInWork(t *testing.T, e *Engine, running *cancelCountSession, id int) {
	t.Helper()
	hs := handoffsOf(e, "discord:ws1")
	if len(hs) != 1 || !teamHandoffOpen(hs[0]) {
		t.Fatalf("handoff after a refused park = %+v, want still open", hs)
	}
	if p, ok := e.WorkspaceParent("discord:ws1"); !ok || p != "discord:chatA" {
		t.Fatalf("workspace owner after a refused park = %q %v, want discord:chatA", p, ok)
	}
	running.mu.Lock()
	n := running.cancels
	running.mu.Unlock()
	if n != 0 {
		t.Fatalf("a refused park stopped the running turn %d times", n)
	}
	task, ok, err := e.TeamTask(id)
	if err != nil || !ok || !teamTaskInWork(task.State) || task.WS != "discord:ws1" {
		t.Fatalf("task #%d = %+v %v %v after a refused park, want still in work on ws1", id, task, ok, err)
	}
}

// #715 review ②: a task's state and its workspace records have one commit point — one write of
// one file. A claim that fails leaves neither; one that succeeds leaves both on disk together, so
// a restart (or a crash at any moment) reads them consistent.
func TestClaimCommitsTaskAndHandoffInOneWrite(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#1", 1); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(e.dataDir, "team_tasks.json")); !os.IsNotExist(err) {
		t.Fatalf("a separate task file was written (%v); task states belong in %s", err, teamWorkspaceFile)
	}
	raw, err := os.ReadFile(teamWorkspacePath(e.dataDir))
	if err != nil {
		t.Fatal(err)
	}
	var disk teamWorkspaceState
	if err := json.Unmarshal(raw, &disk); err != nil {
		t.Fatal(err)
	}
	if tk := disk.Tasks[1]; tk.State != TeamTaskDispatched || tk.WS != "discord:ws1" || len(disk.Handoffs["discord:ws1"]) != 1 {
		t.Fatalf("one write did not hold both the task and its handoff: task=%+v handoffs=%+v", tk, disk.Handoffs["discord:ws1"])
	}

	restore := blockWorkspaceSave(t, e)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws2", "工作区2", "", "#2", 2); err == nil {
		t.Fatal("claim with a failing save succeeded")
	}
	// Still unreadable on disk: the cache is the last commit, without the failed claim.
	if _, ok := e.WorkspaceParent("discord:ws2"); ok {
		t.Fatal("failed claim left ws2 owned in memory")
	}
	if _, ok, err := e.TeamTask(2); err != nil || ok {
		t.Fatalf("failed claim left task #2 recorded: %v %v", ok, err)
	}
	restore()
	// A later unrelated save must not write the failed claim out.
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws4", "工作区4", "", "no board", 0); err != nil {
		t.Fatal(err)
	}
	forgetTeamWorkspaceCache(e)
	if hs := handoffsOf(e, "discord:ws2"); len(hs) != 0 {
		t.Fatalf("handoff to ws2 saved by a failed claim: %+v", hs)
	}
	if _, ok, _ := e.TeamTask(2); ok {
		t.Fatal("task #2 saved by a failed claim")
	}
	if tk, ok, _ := e.TeamTask(1); !ok || tk.State != TeamTaskDispatched {
		t.Fatalf("task #1 lost: %+v", tk)
	}

	// A refused transition (a closed task cannot be dispatched) drops the claim's handoff too.
	teamWorkspaceStore.mu.Lock()
	_, err = transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: 1, To: TeamTaskClosed, By: "test"}, time.Now())
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws3", "工作区3", "", "#1", 1); err == nil {
		t.Fatal("claim of a closed task succeeded")
	}
	if hs := handoffsOf(e, "discord:ws3"); len(hs) != 0 {
		t.Fatalf("refused claim left a handoff in memory: %+v", hs)
	}
}
