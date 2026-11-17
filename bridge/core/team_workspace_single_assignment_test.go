package core

import (
	"errors"
	"testing"
)

// #857: a second claim moved the task's state but left its original handoff and
// session running. Reproduce through the same entry point ws-handoff calls.
func TestWorkspaceActiveTaskCannotClaimAnotherWorkspace(t *testing.T) {
	for _, working := range []bool{false, true} {
		e, _, _ := exitFixture(t, nil)
		e.SetTeam(t.TempDir(), "橘", true)
		if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#823", 823); err != nil {
			t.Fatal(err)
		}
		if working {
			e.teamTaskTurnStarted("discord:ws1")
		}
		err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws2", "工作区2", "", "#823", 823)
		if !errors.Is(err, ErrTeamTaskTransition) {
			t.Fatalf("working=%v: second workspace claim = %v, want ownership transition refused", working, err)
		}
		task, _, err := e.TeamTask(823)
		if err != nil || task.WS != "discord:ws1" {
			t.Fatalf("original assignment changed: %+v, %v", task, err)
		}
		if rows := handoffsOf(e, "discord:ws2"); len(rows) != 0 {
			t.Fatalf("refused claim created a second handoff: %+v", rows)
		}
		if _, owned := e.WorkspaceParent("discord:ws2"); owned {
			t.Fatal("refused claim retained the second workspace")
		}
		if _, err := e.ParkTeamWorkspace("discord:ws1"); err != nil {
			t.Fatal(err)
		}
		if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws2", "工作区2", "", "#823", 823); err != nil {
			t.Fatalf("explicitly paused task cannot move to another workspace: %v", err)
		}
	}
}
