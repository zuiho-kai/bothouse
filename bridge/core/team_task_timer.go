package core

import (
	"fmt"
	"log/slog"
)

// A timer that a workspace task's own process sets for its own session (bgrun's "command ended"
// wake, `later`) belongs to that task, not to the workspace channel: a workspace is a slot that
// tasks pass through. The job names the task by the handoff its process was started for
// (TimerJob.TaskHandoff, the process's CC_HANDOFF, as `bothouse send` does for #1959) and is
// delivered where the task is when it comes due.
//
// Before, the job only carried the session key of the workspace it was set in. 11-21 #928: the
// task asked (ws-up --ask) from 工作区1, its turn ended 15:21:52 and the workspace went back to
// the pool; the command it had started ended 15:24:00 and its wake opened a fresh session in the
// free 工作区1, which worked on the paused task while the answer resumed it in 工作区7. With the
// old workspace taken by another task, the wake would have gone into that task's session.

// taskOfTimer returns the task-board task job was set for: the task of the handoff it names in
// the workspace it was set in. false: the job names none, or that handoff has no board task.
func (e *Engine) taskOfTimer(job *TimerJob) (TeamTask, bool) {
	if job.TaskHandoff == "" || e.dataDir == "" {
		return TeamTask{}, false
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if err != nil {
		slog.Error("timer: workspace state unreadable; the timer's task is unknown", "id", job.ID, "error", err)
		return TeamTask{}, false
	}
	for _, h := range st.Handoffs[teamChatKey(job.SessionKey)] {
		if teamHandoffID(h) == job.TaskHandoff {
			t, ok := st.Tasks[h.Board]
			return t, ok
		}
	}
	return TeamTask{}, false
}

// deliverToTask points a due job that belongs to a workspace task at the session working that
// task now. true: run it. false: not now — the task is in no workspace (paused, asked, handed
// back), so the job stays pending until the task's next turn starts (releaseTaskTimers); a
// closed task's job is dropped.
func (ts *TimerScheduler) deliverToTask(engine *Engine, job *TimerJob) bool {
	t, ok := engine.taskOfTimer(job)
	if !ok {
		return true
	}
	here := teamChatKey(job.SessionKey)
	switch {
	case teamTaskInWork(t.State):
		to := job.SessionKey
		if t.WS != here {
			slog.Info("timer: the job's task moved to another workspace; delivered there", "id", job.ID, "board", t.ID, "from", here, "to", t.WS)
			to = t.WS
		}
		ts.store.setTask(job.ID, to, 0)
		return true
	case teamTurnOfTask(here, t.ID):
		// The turn that paused it (ws-up --ask) still runs here: that turn is the task's session.
		return true
	case t.State == TeamTaskClosed:
		slog.Info("timer: the job's task is closed; not delivered", "id", job.ID, "board", t.ID, "session", job.SessionKey)
		ts.store.MarkFired(job.ID, fmt.Errorf("task #%d is closed", t.ID))
		return false
	}
	slog.Info("timer: the job's task is in no workspace; held until its next turn starts", "id", job.ID, "board", t.ID, "state", string(t.State), "set_in", here)
	ts.store.setTask(job.ID, job.SessionKey, t.ID)
	return false
}

// releaseTaskTimers runs the jobs that waited for task board (deliverToTask), now that a turn of
// the task has started in a workspace again.
func (ts *TimerScheduler) releaseTaskTimers(board int) {
	for _, j := range ts.store.ListPending() {
		if j.WaitsTask == board {
			ts.scheduleAt(j, 0)
		}
	}
}

// setTask saves where a task's job goes (sessionKey) and which task it waits for (0: none).
func (s *TimerStore) setTask(id, sessionKey string, waits int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j.ID == id {
			if j.SessionKey == sessionKey && j.WaitsTask == waits {
				return
			}
			j.SessionKey, j.WaitsTask = sessionKey, waits
			if err := s.save(); err != nil {
				slog.Warn("timer: save after task routing", "error", err)
			}
			return
		}
	}
}
