package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// handoffModelOn gives session key of e a state file in dir with its own model "own-model" and the
// task's model "task-model" applied (a handoff with --model), as before a give-back.
func handoffModelOn(t *testing.T, e *Engine, dir, key string) string {
	t.Helper()
	statePath := filepath.Join(dir, "state.json")
	e.SetProjectStateStore(NewProjectStateStore(statePath))
	if err := e.saveSessionSelection(key, "own-model", ""); err != nil {
		t.Fatal(err)
	}
	if err := e.queueHandoffSwitch(key, pendingModelSwitch{Model: "task-model"}); err != nil {
		t.Fatal(err)
	}
	e.applyPendingSwitch(key)
	return statePath
}

// wantModel checks the selection of key in memory and on disk.
func wantModel(t *testing.T, e *Engine, statePath, key, want string, remembered bool) {
	t.Helper()
	for i, st := range []projectStateData{e.projectState.state, NewProjectStateStore(statePath).state} {
		if got := st.SessionModelOverrides[key].Model; got != want {
			t.Fatalf("model of %s (%s) = %q, want %q", key, []string{"memory", "disk"}[i], got, want)
		}
		if _, ok := st.HandoffModelBases[key]; ok != remembered {
			t.Fatalf("remembered selection of %s (%s) = %v, want %v", key, []string{"memory", "disk"}[i], ok, remembered)
		}
	}
}

// readOnlyDir makes dir unwritable until the returned func runs (also at cleanup).
func readOnlyDir(t *testing.T, dir string) func() {
	t.Helper()
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	writable := func() { _ = os.Chmod(dir, 0o755) }
	t.Cleanup(writable)
	return writable
}

// Review #2076 round 4: between the restore and the failed save of a give-back, the same session
// was given a new model C. The rollback takes back only what the restore wrote, so C stays (the old
// task model B does not overwrite it); a session nobody touched gets B back.
func TestHandoffRestoreUndoKeepsNewerPick(t *testing.T) {
	agent := &stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "own-model"},
		models: []ModelOption{{Name: "own-model"}, {Name: "task-model"}, {Name: "model-c"}}}
	e := NewEngine("test", agent, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	statePath := handoffModelOn(t, e, t.TempDir(), "discord:ws1:u1")
	if err := e.queueHandoffSwitch("discord:ws1:u2", pendingModelSwitch{Model: "task-model"}); err != nil {
		t.Fatal(err)
	}
	e.applyPendingSwitch("discord:ws1:u2")

	undo, err := e.restoreWorkspaceHandoffModels("discord:ws1")
	if err != nil {
		t.Fatal(err)
	}
	wantModel(t, e, statePath, "discord:ws1:u1", "own-model", false)
	// Meanwhile u1 is given model C (chat `model set`).
	if _, err := e.selectSessionModel("discord:ws1:u1", "model-c"); err != nil {
		t.Fatal(err)
	}
	// The give-back's own save then fails: roll back.
	if err := undo(); err != nil {
		t.Fatal(err)
	}
	wantModel(t, e, statePath, "discord:ws1:u1", "model-c", false)
	wantModel(t, e, statePath, "discord:ws1:u2", "task-model", true)
}

// The same race through the queue: a switch queued for the session after the restore is kept, and
// the task's model is not put back over it.
func TestHandoffRestoreUndoKeepsNewerQueuedSwitch(t *testing.T) {
	e := NewEngine("test", &stubModelModeAgent{model: "own-model"}, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	statePath := handoffModelOn(t, e, t.TempDir(), "discord:ws1:u1")
	undo, err := e.restoreWorkspaceHandoffModels("discord:ws1")
	if err != nil {
		t.Fatal(err)
	}
	if err := e.queueHandoffSwitch("discord:ws1:u1", pendingModelSwitch{Model: "model-c"}); err != nil { // the next task's pick
		t.Fatal(err)
	}
	if err := undo(); err != nil {
		t.Fatal(err)
	}
	st := NewProjectStateStore(statePath).state
	if st.PendingModelSwitches["discord:ws1:u1"].Model != "model-c" || st.HandoffModelBases["discord:ws1:u1"].Model != "own-model" ||
		st.SessionModelOverrides["discord:ws1:u1"].Model != "own-model" {
		t.Fatalf("newer pick overwritten by the rollback: %+v", st)
	}
}

// Handback release (releaseTeamWorkspace, used by returnWorkspace and the idle reconcile): a failed
// save keeps the workspace and the task's model; the next try releases and restores.
func TestReleaseSaveFailureKeepsHandoffModel(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	statePath := handoffModelOn(t, e, t.TempDir(), exitWSKey)
	writable := readOnlyDir(t, filepath.Dir(teamWorkspacePath(e.dataDir)))
	if e.releaseTeamWorkspace("discord:ws1", time.Now(), false) {
		t.Fatal("released although its state was not saved")
	}
	if p, ok := e.WorkspaceParent("ws1"); !ok || p != "chatA" {
		t.Fatalf("parent after a failed release = %q,%v", p, ok)
	}
	wantModel(t, e, statePath, exitWSKey, "task-model", true)
	writable()
	if !e.releaseTeamWorkspace("discord:ws1", time.Now(), false) {
		t.Fatal("release after the state is writable")
	}
	wantModel(t, e, statePath, exitWSKey, "own-model", false)
}

// Paused workspace given back when the asking turn ends (freeParkedWorkspace): same.
func TestFreeParkedSaveFailureKeepsHandoffModel(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "t", 7); err != nil {
		t.Fatal(err)
	}
	statePath := handoffModelOn(t, e, t.TempDir(), exitWSKey)
	end := beginTeamTurn(teamTurnFact{Chat: exitWSKey, Session: exitWSKey, Engine: e.name, TaskID: 7})
	if freed, err := e.ParkTeamWorkspaceWhy(exitWSKey, "", time.Time{}, "workspace park", false); err != nil || freed {
		t.Fatalf("park under its own turn = %v, %v", freed, err)
	}
	end()
	wantModel(t, e, statePath, exitWSKey, "task-model", true) // not given back yet
	writable := readOnlyDir(t, filepath.Dir(teamWorkspacePath(e.dataDir)))
	if e.freeParkedWorkspace(exitWSKey) {
		t.Fatal("given back although its state was not saved")
	}
	if _, ok := e.WorkspaceParent("ws1"); !ok {
		t.Fatal("workspace dropped although the give-back was not saved")
	}
	wantModel(t, e, statePath, exitWSKey, "task-model", true)
	writable()
	if !e.freeParkedWorkspace(exitWSKey) {
		t.Fatal("give-back after the state is writable")
	}
	wantModel(t, e, statePath, exitWSKey, "own-model", false)
}

// failingDeleteGuild refuses to delete the channel while fail is set.
type failingDeleteGuild struct {
	*deletingGuild
	fail bool
}

func (g *failingDeleteGuild) DeleteTeamWorkspaceChannel(ctx context.Context, id string) error {
	if g.fail {
		return errors.New("discord: 500")
	}
	return g.deletingGuild.DeleteTeamWorkspaceChannel(ctx, id)
}

// Delete: the channel delete fails after the restore, the workspace stays and so does the model.
func TestDeleteFailureKeepsHandoffModel(t *testing.T) {
	g := &failingDeleteGuild{deletingGuild: &deletingGuild{fakeWorkspaceGuild: newWorkspaceGuild()}, fail: true}
	g.channels = append(g.channels, TeamChannel{ID: "206", Name: "工作区6", ParentID: "catB"})
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "橘", true)
	e.SetTeamWorkspaces(true)
	statePath := handoffModelOn(t, e, t.TempDir(), "discord:206:u1")
	if err := e.DeleteTeamWorkspace("discord:206"); err == nil {
		t.Fatal("delete reported success although the platform refused")
	}
	wantModel(t, e, statePath, "discord:206:u1", "task-model", true)
	g.fail = false
	if err := e.DeleteTeamWorkspace("discord:206"); err != nil {
		t.Fatal(err)
	}
	wantModel(t, e, statePath, "discord:206:u1", "own-model", false)
}

// Delete: the channel is gone but the local record could not be dropped (state file unwritable).
// The delete has happened, so the restore stands: the sessions there are back on their own model,
// not rolled back to a workspace that no longer exists (review #2076 round 4 follow-up).
func TestDeleteLocalSaveFailureKeepsRestore(t *testing.T) {
	g := &failingDeleteGuild{deletingGuild: &deletingGuild{fakeWorkspaceGuild: newWorkspaceGuild()}}
	g.channels = append(g.channels, TeamChannel{ID: "206", Name: "工作区6", ParentID: "catB"})
	dataDir := t.TempDir()
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(dataDir)
	e.SetTeam(t.TempDir(), "橘", true)
	e.SetTeamWorkspaces(true)
	statePath := handoffModelOn(t, e, t.TempDir(), "discord:206:u1")
	if err := os.MkdirAll(filepath.Join(dataDir, teamWorkspaceArchiveDir), 0o700); err != nil {
		t.Fatal(err) // the archive still lands; only the workspace state beside it cannot be written
	}
	readOnlyDir(t, dataDir)
	if err := e.DeleteTeamWorkspace("discord:206"); err != nil {
		t.Fatalf("delete with the channel gone = %v, want done", err)
	}
	if gone, _ := g.TeamChannelGone(context.Background(), "206"); !gone {
		t.Fatal("channel not deleted")
	}
	wantModel(t, e, statePath, "discord:206:u1", "own-model", false)
}
