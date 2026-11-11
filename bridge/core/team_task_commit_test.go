package core

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// #1632 review ①: only a missing task file is an empty store. A file that does not parse, or one
// that cannot be read, is an error; the transition writes nothing and the file keeps its bytes.
func TestTeamTaskStoreUnreadableIsNotEmpty(t *testing.T) {
	now := time.Now()
	step := func(dir string, ev teamTaskEvent) error {
		teamWorkspaceStore.mu.Lock()
		defer teamWorkspaceStore.mu.Unlock()
		_, err := transitionTeamTaskLocked(dir, ev, now)
		return err
	}

	dir := t.TempDir()
	if err := step(dir, teamTaskEvent{ID: 1, To: TeamTaskDispatched, WS: "discord:ws1"}); err != nil {
		t.Fatalf("first transition on a missing file = %v, want an empty store", err)
	}
	broken := []byte(`[{"id":1,"state":"dispatched"},{"id":2,"state":"wor`) // cut mid-write
	if err := os.WriteFile(teamTaskPath(dir), broken, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := step(dir, teamTaskEvent{ID: 3, To: TeamTaskDispatched, WS: "discord:ws2"}); err == nil {
		t.Fatal("transition over a file that does not parse succeeded; it would have saved over tasks #1 and #2")
	}
	if got, _ := os.ReadFile(teamTaskPath(dir)); !bytes.Equal(got, broken) {
		t.Fatalf("unparseable task file was rewritten:\n%s", got)
	}
	e := &Engine{dataDir: dir}
	if _, _, err := e.TeamTask(1); err == nil {
		t.Fatal("TeamTask on an unparseable file reported \"never seen\" instead of an error")
	}

	// A read error other than "does not exist": the path is a directory.
	dir2 := t.TempDir()
	if err := os.Mkdir(teamTaskPath(dir2), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := step(dir2, teamTaskEvent{ID: 1, To: TeamTaskDispatched, WS: "discord:ws1"}); err == nil {
		t.Fatal("transition over an unreadable task file succeeded")
	}
	if fi, err := os.Stat(teamTaskPath(dir2)); err != nil || !fi.IsDir() {
		t.Fatalf("unreadable task path was replaced: %v %v", fi, err)
	}
}

// blockWorkspaceSave makes the next save of the workspace file fail (its path becomes a non-empty
// directory, so the atomic rename fails) and returns a function that puts the old file back.
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

// #1632 review ②, park side: a park whose task state cannot be written does not succeed, does not
// free the workspace and does not stop the turn; the handoff stays open and the task in work.
func TestParkRefusedWhenTaskStateCannotBeWritten(t *testing.T) {
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

	// (a) the task file does not parse.
	good, err := os.ReadFile(teamTaskPath(e.dataDir))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(teamTaskPath(e.dataDir), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	if freed, err := e.ParkTeamWorkspaceWhy("discord:ws1", h.Chat, h.At, "watch: no progress", true); err == nil || freed {
		t.Fatalf("park over an unparseable task file = %v, %v; want an error, workspace kept", freed, err)
	}
	if got, _ := os.ReadFile(teamTaskPath(e.dataDir)); string(got) != "{" {
		t.Fatalf("task file rewritten by a refused park: %s", got)
	}
	assertStillInWork(t, e, running, 677)

	// (b) the workspace save fails after the task file was written: the task file is put back.
	if err := os.WriteFile(teamTaskPath(e.dataDir), good, 0o644); err != nil {
		t.Fatal(err)
	}
	restore := blockWorkspaceSave(t, e)
	if freed, err := e.ParkTeamWorkspaceWhy("discord:ws1", h.Chat, h.At, "watch: no progress", true); err == nil || freed {
		t.Fatalf("park with a failing workspace save = %v, %v; want an error, workspace kept", freed, err)
	}
	if got, _ := os.ReadFile(teamTaskPath(e.dataDir)); !bytes.Equal(got, good) {
		t.Fatalf("task file not put back after the workspace save failed:\n%s", got)
	}
	restore()
	assertStillInWork(t, e, running, 677)

	// With both stores writable the same park goes through.
	if freed, err := e.ParkTeamWorkspaceWhy("discord:ws1", h.Chat, h.At, "watch: no progress", true); err != nil || !freed {
		t.Fatalf("park after the stores recovered = %v, %v", freed, err)
	}
	if task, _, _ := e.TeamTask(677); task.State != TeamTaskPaused {
		t.Fatalf("task #677 = %+v after the park, want paused", task)
	}
}

// assertStillInWork: nothing of a refused park leaked — handoff open (read back from disk, not
// from a cache the park changed), workspace owned, turn not stopped, task in work there.
func assertStillInWork(t *testing.T, e *Engine, running *cancelCountSession, id int) {
	t.Helper()
	teamWorkspaceStore.mu.Lock()
	dropTeamWorkspaceCacheLocked(teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
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
	if err == nil && (!ok || !teamTaskInWork(task.State) || task.WS != "discord:ws1") {
		t.Fatalf("task #%d = %+v after a refused park, want still in work on ws1", id, task)
	}
}

// #1632 review ②, claim side: a claim whose workspace save fails leaves no dispatched task behind,
// and one whose task store is unreadable records no handoff.
func TestClaimCommitsTaskAndHandoffTogether(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#1", 1); err != nil {
		t.Fatal(err)
	}
	tasksBefore, err := os.ReadFile(teamTaskPath(e.dataDir))
	if err != nil {
		t.Fatal(err)
	}

	restore := blockWorkspaceSave(t, e)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws2", "工作区2", "", "#2", 2); err == nil {
		t.Fatal("claim with a failing workspace save succeeded")
	}
	restore()
	if got, _ := os.ReadFile(teamTaskPath(e.dataDir)); !bytes.Equal(got, tasksBefore) {
		t.Fatalf("task #2 left dispatched although its handoff was not saved:\n%s", got)
	}
	teamWorkspaceStore.mu.Lock()
	dropTeamWorkspaceCacheLocked(teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
	if hs := handoffsOf(e, "discord:ws2"); len(hs) != 0 {
		t.Fatalf("handoff to ws2 saved by a failed claim: %+v", hs)
	}

	// Task store unreadable: refused before anything is saved, and the in-memory claim is dropped
	// (a later unrelated save must not write it out).
	if err := os.WriteFile(teamTaskPath(e.dataDir), []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws3", "工作区3", "", "#3", 3); err == nil {
		t.Fatal("claim over an unparseable task file succeeded")
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws4", "工作区4", "", "no board", 0); err != nil {
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Lock()
	dropTeamWorkspaceCacheLocked(teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
	if hs := handoffsOf(e, "discord:ws3"); len(hs) != 0 {
		t.Fatalf("refused claim of ws3 was written out by a later save: %+v", hs)
	}
	if got, _ := os.ReadFile(teamTaskPath(e.dataDir)); string(got) != "not json" {
		t.Fatalf("unparseable task file rewritten: %s", got)
	}
	if _, _, err := e.TeamTask(3); err == nil || errors.Is(err, ErrTeamTaskTransition) {
		t.Fatalf("TeamTask over an unparseable file = %v, want a read error", err)
	}
}
