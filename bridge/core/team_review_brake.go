package core

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Brakes on automatic review turns (#1120, agentm 11-06 23:2xZ). A review reminder was checked
// against the board only when it started: once running, a `board pause` of its task did not stop
// it (the DSH reviewer went on reading and writing files until it was killed by hand), and a /new
// cleared the session's user activity, so a reminder held for the user ran a minute after the
// reset. User 11-06 「我现在说暂停，他还在跑」.

// reviewBrakeCheck: how often the watch looks whether board.jsonl changed (a stat, no read);
// a var so tests can shorten it.
var reviewBrakeCheck = time.Second

// reviewBrakeLoop follows the task board file: after every change it stops review turns of
// tasks that are now paused, on every engine of the watch.
func (w *handoffWatch) reviewBrakeLoop(ctx context.Context) {
	e := w.e
	if e == nil || e.team == nil {
		return
	}
	path := filepath.Join(e.team.dir, teamTaskBoardFile)
	t := time.NewTicker(reviewBrakeCheck)
	defer t.Stop()
	var mod time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		st, err := os.Stat(path)
		if err != nil || st.ModTime().Equal(mod) {
			continue
		}
		mod = st.ModTime()
		for _, x := range w.engines() {
			x.stopPausedTaskReviews()
		}
	}
}

// reviewForPaused: the reminder verifies (or rounds up only) tasks that are now paused. The
// reminders about a paused task itself (ref.Paused) stay: they exist for paused tasks.
func reviewForPaused(ref *taskReviewRef, paused map[int]bool) bool {
	if ref == nil || ref.Paused != "" {
		return false
	}
	if len(ref.Items) == 0 {
		return paused[ref.Board]
	}
	for _, r := range ref.Items {
		if r.Paused != "" || !paused[r.Board] {
			return false
		}
	}
	return true
}

// stopPausedTaskReviews drops e's queued review reminders of paused tasks and stops the review
// turn that is running for one; returns how many turns it stopped.
func (e *Engine) stopPausedTaskReviews() int {
	if e.timerScheduler == nil || e.team == nil {
		return 0
	}
	paused := map[int]bool{}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.Paused != "" {
			paused[it.ID] = true
		}
	}
	if len(paused) == 0 {
		return 0
	}
	stale := map[string]*TimerJob{}
	for _, j := range e.timerScheduler.store.List() {
		if j.Project != e.name || !reviewForPaused(j.TaskReview, paused) {
			continue
		}
		stale[j.ID] = j
		if !j.Fired {
			e.timerScheduler.RemoveJob(j.ID)
			slog.Info("task review: task paused; queued reminder dropped", "project", e.name, "id", j.ID, "board", j.TaskReview.Board)
		}
	}
	if len(stale) == 0 {
		return 0
	}
	keys := map[string]*TimerJob{}
	scheduledTurnsMu.Lock()
	for id, k := range e.scheduledTurns {
		if j := stale[id]; j != nil && k != "" {
			keys[k] = j
		}
	}
	scheduledTurnsMu.Unlock()
	e.interactiveMu.Lock()
	for k, st := range e.interactiveStates {
		if st == nil {
			continue
		}
		st.mu.Lock()
		id := st.currentJobID
		st.mu.Unlock()
		if j := stale[id]; j != nil {
			keys[k] = j
		}
	}
	e.interactiveMu.Unlock()
	stopped := 0
	for k, j := range keys {
		if tj := e.turnJournalStore(); tj != nil && tj.Active(k) == "" {
			continue // that turn already ended
		}
		if !e.stopInteractiveSessionSilently(k) {
			continue
		}
		stopped++
		slog.Warn("task review: task paused; running review stopped", "project", e.name, "id", j.ID, "board", j.TaskReview.Board, "session", k)
		e.quotaNotice(teamChatKey(j.SessionKey), e.i18n.Tf(MsgTaskReviewPausedStopped, j.TaskReview.Board))
	}
	return stopped
}

// stopTimerTurnsIn stops e's scheduled side-session turns (#timer:*) of the chat sessionKey is
// in: a person's /new ends that conversation's background turns too (#1120).
func (e *Engine) stopTimerTurnsIn(platform, sessionKey string) int {
	target, ok := sessionKeyChannel(sessionKey, platform)
	if !ok {
		return 0
	}
	e.interactiveMu.Lock()
	var keys []string
	for k := range e.interactiveStates {
		if !strings.Contains(k, "#timer:") {
			continue
		}
		if ch, ok := sessionKeyChannel(strings.SplitN(k, "#timer:", 2)[0], platform); ok && ch == target {
			keys = append(keys, k)
		}
	}
	e.interactiveMu.Unlock()
	stopped := 0
	for _, k := range keys {
		if e.stopInteractiveSessionSilently(k) {
			stopped++
			slog.Info("cmdNew: stopped a scheduled side turn of this chat", "project", e.name, "session", k)
		}
	}
	return stopped
}
