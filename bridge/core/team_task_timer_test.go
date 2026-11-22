package core

import (
	"strings"
	"testing"
	"time"
)

// taskTimerFixture: task #7 handed to ws1 and a wake its process set for itself there (as bgrun
// does when its command ends), not due yet.
func taskTimerFixture(t *testing.T) (*Engine, *inputTestAgent, *TimerScheduler) {
	t.Helper()
	e, p := reportFixture(t)
	e.platformReady = map[Platform]bool{p: true}
	e.SetTeam(t.TempDir(), "橘", true)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	ts.RegisterEngine(e.name, e)
	e.timerScheduler = ts
	t.Cleanup(ts.Stop)
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "t", 7); err != nil {
		t.Fatal(err)
	}
	job := &TimerJob{ID: "bg", Project: e.name, SessionKey: "discord:ws1", ScheduledAt: time.Now().Add(-time.Hour),
		Prompt: "后台命令结束", TaskHandoff: e.workspaceHandoffID("discord:ws1"), CreatedAt: time.Now()}
	if job.TaskHandoff == "" {
		t.Fatal("no handoff in work in ws1")
	}
	if err := store.Add(job); err != nil {
		t.Fatal(err)
	}
	return e, e.agent.(*inputTestAgent), ts
}

// 11-21 #928: the task asked and its turn ended, the workspace went back to the pool, and the
// wake of the command it had started opened a session in the old workspace. The wake waits for
// the task and goes to the workspace that resumes it; the task now in the old one never sees it.
func TestTaskTimerWaitsForItsTaskAndFollowsIt(t *testing.T) {
	e, agent, ts := taskTimerFixture(t)
	if freed, err := e.ParkTeamWorkspaceWhy("discord:ws1", "", time.Time{}, "workspace park", false); err != nil || !freed {
		t.Fatalf("park = %v, %v; want ws1 given back", freed, err)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "u", 8); err != nil {
		t.Fatal(err)
	}

	ts.executeJob("bg")
	if job := ts.store.Get("bg"); job.Fired || job.WaitsTask != 7 || job.SessionKey != "discord:ws1" {
		t.Fatalf("wake of the paused task = %+v, want pending for task 7", job)
	}
	if n := agent.session.normal.Load() + agent.session.strict.Load(); n != 0 {
		t.Fatalf("%d prompts reached ws1, now task 8's", n)
	}

	// A restart looks at the waiting job again; overdue by an hour, it is neither run nor dropped.
	again := NewTimerScheduler(ts.store)
	again.RegisterEngine(e.name, e)
	if err := again.Start(); err != nil {
		t.Fatal(err)
	}
	again.Stop()
	if job := ts.store.Get("bg"); job.Fired || job.WaitsTask != 7 {
		t.Fatalf("waiting wake after a restart = %+v, want still pending for task 7", job)
	}

	// The answer resumes the task in another workspace: its first turn there takes the wake.
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws2", "工作区2", "", "t", 7); err != nil {
		t.Fatal(err)
	}
	e.teamTaskTurnStarted("discord:ws2")
	if prompt := inputPrompt(t, agent); !strings.Contains(prompt, "后台命令结束") {
		t.Fatalf("prompt = %q, want the wake", prompt)
	}
	if job := ts.store.Get("bg"); job.SessionKey != "discord:ws2" || job.WaitsTask != 0 {
		t.Fatalf("wake delivered as %+v, want in ws2", job)
	}
	inputDone(agent, "ok")
	inputWait(t, func() bool { return ts.store.Get("bg").Fired })
}

// The turn that asked still runs in the workspace: the wake of its own command goes to it.
func TestTaskTimerReachesTheTurnThatAsked(t *testing.T) {
	e, agent, ts := taskTimerFixture(t)
	end := beginTeamTurn(teamTurnFact{Chat: "discord:ws1", Session: "discord:ws1", Engine: e.name, TaskID: 7})
	defer end()
	if freed, err := e.ParkTeamWorkspaceWhy("discord:ws1", "", time.Time{}, "workspace park", false); err != nil || freed {
		t.Fatalf("park under its own turn = %v, %v; want paused, not given back", freed, err)
	}
	go ts.executeJob("bg")
	if prompt := inputPrompt(t, agent); !strings.Contains(prompt, "后台命令结束") {
		t.Fatalf("prompt = %q, want the wake", prompt)
	}
	inputDone(agent, "ok")
	inputWait(t, func() bool { return ts.store.Get("bg").Fired })
}

// A closed task's wake is dropped: nobody works on it again.
func TestTaskTimerOfClosedTaskDropped(t *testing.T) {
	e, agent, ts := taskTimerFixture(t)
	teamWorkspaceStore.mu.Lock()
	_, err := transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: 7, To: TeamTaskClosed, By: "test"}, time.Now())
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	ts.executeJob("bg")
	if job := ts.store.Get("bg"); !job.Fired || !strings.Contains(job.LastError, "closed") {
		t.Fatalf("wake of the closed task = %+v, want dropped", job)
	}
	if n := agent.session.normal.Load() + agent.session.strict.Load(); n != 0 {
		t.Fatalf("%d prompts sent for a closed task", n)
	}
}
