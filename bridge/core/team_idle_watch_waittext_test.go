package core

import (
	"testing"
	"time"
)

// #1492 常识：说在等，就得真问了人。A workspace that only wrote `board update 9 等用户确认` and ended
// its turn asked nobody, yet the idle watch never woke it again: every check pushed the due time back.
func TestWorkspaceWaitTextDoesNotSilenceTheWatch(t *testing.T) {
	e, _ := acceptFixture(t)
	now := time.Now()
	h := TeamHandoff{Chat: "discord:chat1", At: now.Add(-20 * time.Minute), Due: now.Add(5 * time.Minute), Owner: e.name, Title: "#9 接口", Sender: e.name, Board: 9, Idle: watchIdleState{Ended: now}}
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{Version: teamWorkspaceStateVersion,
		Parents:  map[string][]TeamWorkspace{"discord:chat1": {{Name: "工作区1", ID: "ws1"}}},
		Handoffs: map[string][]TeamHandoff{"discord:ws1": {h}}})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := e.WorkspaceParent("discord:ws1"); !ok {
		t.Skip("fixture does not resolve the workspace parent")
	}
	writeReleaseBoard(t, e, map[string]any{"id": 9, "what": "接口", "status": "等用户确认", "who": "橘", "ws": "discord:ws1", "chat": "discord:chat1"})
	e.fireIdleWake(idleAssignment{"discord:ws1", h, false})
	teamWorkspaceStore.mu.Lock()
	st := testLoadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
	got := st.Handoffs["discord:ws1"]
	if len(got) != 1 || got[0].Idle.Wakes == 0 && !got[0].Idle.Reported {
		t.Fatalf("a bare 「等用户确认」 in a workspace silenced the watch: %+v", got)
	}
}
