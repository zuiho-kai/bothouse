package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// #509: reconcileTeamWorkspaces used to free a workspace as soon as its bound board item
// looked finished, without looking at teamTaskBoardLastActive. A mis-judged item (someone
// ran board done, the item was moved) therefore killed a workspace that was still moving.
// A bound item that reported progress within teamWorkspaceReconcileGrace now keeps it.
func reconcileGraceFixture(t *testing.T, status string, progress, boardAt time.Time, boardBound string) (*Engine, *handoffWatch, time.Time) {
	t.Helper()
	now := time.Now()
	e, _, _ := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	e.handoffWatchOn.Store(true)
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区1", "", "回收宽限"); err != nil {
		t.Fatal(err)
	}
	// The handoff is old: only the board item's own activity may keep the workspace.
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	st := testLoadTeamWorkspacesLocked(path)
	for i := range st.Handoffs["discord:ws1"] {
		st.Handoffs["discord:ws1"][i].At = now.Add(-3 * time.Hour)
		st.Handoffs["discord:ws1"][i].Due = time.Time{}
	}
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		teamWorkspaceStore.mu.Unlock()
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Unlock()

	progressAt := 0.0
	if !progress.IsZero() {
		progressAt = float64(progress.Unix())
	}
	line, err := json.Marshal(map[string]any{
		"id": 509, "what": "回收宽限", "short": "回收宽限", "status": status, "who": "肥鱼",
		"ws": "discord:ws1", "sk": "discord:ws1", "chat": "discord:main",
		"at": boardAt.Format("01-02 15:04"), "bound": boardBound, "progress_at": progressAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardFile), append(line, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	return e, newHandoffWatch(e), now
}

func TestReconcileGrace_RecentProgressOnFinishedItemKeepsWorkspace(t *testing.T) {
	now := time.Now()
	e, w, at := reconcileGraceFixture(t, "已完成", now.Add(-2*time.Minute), now.Add(-3*time.Hour), now.Add(-3*time.Hour).Format(time.RFC3339))
	if freed := w.reconcileTeamWorkspaces(at); len(freed) != 0 {
		t.Fatalf("workspace with a 2-minute-old progress report was freed: %v", freed)
	}
	if _, ok := e.WorkspaceParent("discord:ws1"); !ok {
		t.Fatal("workspace went back to the pool although its item moved 2 minutes ago")
	}
}

func TestReconcileGrace_StaleProgressOnFinishedItemIsStillFreed(t *testing.T) {
	now := time.Now()
	e, w, at := reconcileGraceFixture(t, "已完成", now.Add(-time.Hour), now.Add(-3*time.Hour), now.Add(-3*time.Hour).Format(time.RFC3339))
	freed := w.reconcileTeamWorkspaces(at)
	if len(freed) != 1 || freed[0] != "discord:ws1" {
		t.Fatalf("stale item must still free the workspace, freed %v", freed)
	}
	if _, ok := e.WorkspaceParent("discord:ws1"); ok {
		t.Fatal("released workspace is still owned")
	}
}

func TestReconcileGrace_NoProgressDataStillFrees(t *testing.T) {
	now := time.Now()
	e, w, at := reconcileGraceFixture(t, "已完成", time.Time{}, now.Add(-3*time.Hour), now.Add(-3*time.Hour).Format(time.RFC3339))
	freed := w.reconcileTeamWorkspaces(at)
	if len(freed) != 1 || freed[0] != "discord:ws1" {
		t.Fatalf("an item that never reported progress must not be kept forever, freed %v", freed)
	}
	if _, ok := e.WorkspaceParent("discord:ws1"); ok {
		t.Fatal("released workspace is still owned")
	}
}
