package core

import (
	"errors"
	"slices"
	"testing"
	"time"
)

// #699 batch B: the 11-11 15:22–15:52 timeline of 工作区3 (#677, then #679; ~/Library/Logs/BotHouse/
// main.log, design §2) as one test. Each step is what the log shows; each check is what went wrong.
//
//	15:22:18 the watch renewed #677; its turn was running (15:31:57 queue log: turn_elapsed=9m23s)
//	15:42    the watch judged "no busy session" and parked: its workspaceBusy scanned only the main
//	         session table, the turn's session was in the workspace pool's (§2 item 5)
//	15:42:19 the workspace was given back while the turn still ran (item 3)
//	15:52:44 #679 was claimed into the same workspace, the old turn still running (15:51:41 8m26s)
//
// The turn here is registered the way the engine registers every turn (beginTeamTurn at the turn's
// start), and no session of e.sessions is locked: like on 11-11, the turn's session is in another
// table. Before batch B each check below failed.
func TestTimeline698WorkspaceThree(t *testing.T) {
	e, _, w, _ := progressFixtureBoard(t, "", 677)
	const ws = "discord:ws1"

	// 15:13 #677's turn starts: its task moves to working and the turn carries its id.
	id := e.teamTaskTurnStarted(ws)
	if id != 677 {
		t.Fatalf("turn start: task %d, want 677", id)
	}
	if task, _, _ := e.TeamTask(677); task.State != TeamTaskWorking {
		t.Fatalf("#677 after its turn started = %+v, want working", task)
	}
	endTurn := beginTeamTurn(teamTurnFact{Chat: ws, TaskID: id})
	defer endTurn()

	// 15:32 / 15:42: both busy answers see the running turn (item 5: they disagreed).
	if !w.workspaceBusy(ws) {
		t.Fatal("15:42 the watch's busy check missed the running turn (item 5)")
	}
	if !e.watchBusy(ws) {
		t.Fatal("watchBusy missed the running turn")
	}

	// 15:42:19 #677 leaves the workspace while its turn still runs (a park from inside the turn,
	// which is not stopped): the records free it, the running turn does not.
	if freed, err := e.ParkTeamWorkspace(ws); err != nil || !freed {
		t.Fatalf("park #677 = %v, %v", freed, err)
	}
	if slices.Contains(e.TeamIdleWorkspaceNames("discord:chatA"), "工作区1") {
		t.Fatal("15:42:19 the workspace was listed idle with #677's turn still running (item 3)")
	}

	// 15:52:44 #679 is refused there while that turn runs …
	err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#679", 679)
	if !errors.Is(err, ErrTeamWorkspaceOwned) {
		t.Fatalf("15:52:44 claim of #679 into a workspace still running #677's turn = %v, want refused (item 3)", err)
	}

	// … and taken once the turn ended; its own turn then carries #679, and #677 stays paused.
	endTurn()
	if !slices.Contains(e.TeamIdleWorkspaceNames("discord:chatA"), "工作区1") {
		t.Fatal("the workspace is not idle after #677's turn ended")
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#679", 679); err != nil {
		t.Fatalf("claim of #679 after the turn ended: %v", err)
	}
	if id := e.teamTaskTurnStarted(ws); id != 679 {
		t.Fatalf("#679's turn carries task %d, want 679", id)
	}
	if task, _, _ := e.TeamTask(677); task.State != TeamTaskPaused || task.WS != "" {
		t.Fatalf("#677 = %+v, want still paused, out of the workspace", task)
	}
}

// #698 item 4: the paused #677 lost its session (ResetTeamWorkspaceSessions cleared it) and its
// resume started from nothing. The park saves the session in the task's record; a resume into the
// workspace gets it back.
func TestParkSavesSessionAndResumeRestoresIt(t *testing.T) {
	e, _, _, _ := progressFixtureBoard(t, "", 677)
	const ws = "discord:ws1"
	e.sessions.GetOrCreateActive(ws).SetAgentSessionID("agent-677", "claudecode")
	if _, err := e.ParkTeamWorkspaceWhy(ws, "discord:chatA", time.Time{}, "watch: no progress", true); err != nil {
		t.Fatal(err)
	}
	task, _, _ := e.TeamTask(677)
	if task.State != TeamTaskPaused || task.Session != "agent-677" || task.SessionEngine != e.name {
		t.Fatalf("#677 after the park = %+v, want paused with its session saved", task)
	}
	if got := e.sessions.GetOrCreateActive(ws).GetAgentSessionID(); got != "" {
		t.Fatalf("workspace session after the park = %q, want reset", got)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#677", 677); err != nil {
		t.Fatal(err)
	}
	if got := e.sessions.GetOrCreateActive(ws).GetAgentSessionID(); got != "agent-677" {
		t.Fatalf("resumed #677's session = %q, want its saved agent-677", got)
	}
}
