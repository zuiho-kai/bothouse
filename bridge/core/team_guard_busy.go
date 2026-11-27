package core

import (
	"log/slog"
	"regexp"
	"strconv"
	"time"
)

// The handback guard (board.py arm_guard) wakes the lead 30 minutes after a hand-off to look at a task
// that has not come back. #1972: the lead was woken to find the workspace still working and answer
// NO_REPLY. The bridge sees that itself first: a workspace with a turn running or a live background
// command is working, so the guard looks again later; a task already paused or gone needs no look.

var guardBoardID = regexp.MustCompile(`兜底 #(\d+)`)

// guardRecheck: how much later a guard looks again while the workspace works (board.py GUARD_DELAY).
var guardRecheck = 30 * time.Minute

// guardVerdict: "busy" (look again later), "done" (no look needed), "" (wake the lead as before).
func (e *Engine) guardVerdict(job *TimerJob) string {
	m := guardBoardID.FindStringSubmatch(job.Description)
	if m == nil || e.team == nil || e.team.dir == "" {
		return ""
	}
	id, _ := strconv.Atoi(m[1])
	if task, known, err := e.TeamTask(id); err != nil {
		slog.Warn("timer: could not read task state for guard", "board_item", id, "error", err)
	} else if known && (task.State == TeamTaskReturned || task.State == TeamTaskClosed) {
		return "done"
	}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ID != id {
			continue
		}
		if it.Paused != "" || !it.ReturnedAt.IsZero() {
			return "done"
		}
		if it.WS == "" {
			return ""
		}
		ws := teamChatKey(it.WS)
		if teamTurnRunning(ws) || e.watchBackgroundRun(ws) != "" {
			return "busy"
		}
		return ""
	}
	return "done"
}

// holdGuardWhileWorking runs before a guard timer wakes the lead. It reports whether the job was
// handled here (postponed or dropped).
func (ts *TimerScheduler) holdGuardWhileWorking(engine *Engine, job *TimerJob) bool {
	if !job.Guard {
		return false
	}
	switch engine.guardVerdict(job) {
	case "busy":
		ts.store.Reschedule(job.ID, time.Now().Add(guardRecheck))
		slog.Info("timer: guard held, the workspace is still working", "id", job.ID, "desc", job.Description, "recheck", guardRecheck)
		ts.scheduleAt(job, guardRecheck)
		return true
	case "done":
		ts.store.MarkFired(job.ID, nil)
		slog.Info("timer: guard dropped, the task no longer needs a handback check", "id", job.ID, "desc", job.Description)
		return true
	}
	return false
}
