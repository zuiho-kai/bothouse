package core

import (
	"os"
	"testing"
	"time"
)

// #1492 常识：没存成不算做成。A release whose state could not be saved returned true, so the
// callers reset every session of the workspace and drained the queue while the record still said
// the task was open there.
func TestReleaseWithFailedSaveIsNotReported(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.platformReady = map[Platform]bool{p: true}
	exitBoardItem(t, e, 11, "x")
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "", "#11", 11); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(e.dataDir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(e.dataDir, 0o700) })
	if e.releaseTeamWorkspace("discord:ws1", time.Now(), false) {
		t.Fatal("release reported done although its state was not saved")
	}
}
