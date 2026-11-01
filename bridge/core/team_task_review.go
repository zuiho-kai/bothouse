package core

import (
	"crypto/sha256"
	"fmt"
	"log/slog"
	"strconv"
	"time"
)

// SetTaskReviewAfter configures the existing stuck threshold for handback verification.
func (e *Engine) SetTaskReviewAfter(after time.Duration) { e.teamReviewAfter = after }

func (e *Engine) taskReviewAfter() time.Duration {
	if e.teamReviewAfter > 0 {
		return e.teamReviewAfter
	}
	return teamTaskBoardStuckAfter
}

func taskReviewOverdue(it teamTaskBoardItem, now time.Time) bool {
	after := it.reviewAfter
	if after <= 0 {
		after = teamTaskBoardStuckAfter
	}
	return !it.ReturnedAt.IsZero() && !now.Before(it.ReturnedAt.Add(after))
}

func taskReviewNote(it teamTaskBoardItem, now time.Time) string {
	who := it.reviewerName
	if who == "" {
		who = it.Reviewer
	}
	if who == "" {
		who = "派活人"
	}
	if taskReviewOverdue(it, now) {
		return "没人验收 · 等" + boardLabel(who)
	}
	return "已交回待核对 · 等" + boardLabel(who)
}

func (e *Engine) taskReviewerName(project string) string {
	for _, x := range e.watchEngines() {
		if x.name == project {
			return x.DisplayName()
		}
	}
	return project
}

// taskReviewRef ties a persisted timer to one handback. Rework creates a new ReturnedAt;
// an accepted or rejected task invalidates already queued reminders before they run.
type taskReviewRef struct {
	Board      int       `json:"board"`
	ReturnedAt time.Time `json:"returned_at"`
}

func (e *Engine) taskReviewPending(ref *taskReviewRef) bool {
	if e.team == nil {
		return false
	}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ID == ref.Board && it.ReturnedAt.Equal(ref.ReturnedAt) {
			return true
		}
	}
	return false
}

// reconcileTaskReviews runs on the existing workspace watch, and immediately after a
// delivered report. Timer IDs are persisted receipts, so a restart cannot duplicate a stage.
func (w *handoffWatch) reconcileTaskReviews(now time.Time, roundup bool) {
	e := w.e
	if e.team == nil {
		return
	}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ReturnedAt.IsZero() || it.Chat == "" {
			// Upgrade only from a delivered report receipt, never workspace release.
			if it.Chat != "" && it.ReviewRejected == "" && it.Paused == "" {
				e.teamExit.mu.Lock()
				at := e.readExitReported()[strconv.Itoa(it.ID)]
				e.teamExit.mu.Unlock()
				bound, _ := time.Parse(time.RFC3339Nano, it.Bound)
				if !at.IsZero() && !at.Before(bound) {
					reviewer := it.Dispatcher
					if reviewer == "" {
						reviewer = e.name
					}
					if out, err := e.runLeadScript(it.Chat, "board", "returned", strconv.Itoa(it.ID), reviewer, at.Format(time.RFC3339Nano)); err != nil {
						slog.Warn("task review: recover delivered handback failed", "board", it.ID, "error", err, "output", string(out))
					}
				}
			}
			continue
		}
		var reviewer *Engine
		for _, x := range w.engines() {
			if x.name == it.Reviewer {
				reviewer = x
				break
			}
		}
		if reviewer == nil || reviewer.timerScheduler == nil {
			slog.Warn("task review: dispatcher unavailable; pending handback retained", "board", it.ID, "reviewer", it.Reviewer)
			continue
		}
		it.reviewAfter = reviewer.taskReviewAfter()
		stages := []string{"returned"}
		if taskReviewOverdue(it, now) {
			stages = append(stages, "overdue")
		}
		if roundup {
			stages = append(stages, "roundup-"+now.Truncate(teamWorkspaceReconcileEvery).UTC().Format(time.RFC3339))
		}
		for _, stage := range stages {
			sum := sha256.Sum256([]byte(fmt.Sprintf("%s/%d/%s/%s", e.team.dir, it.ID, it.ReturnedAt.Format(time.RFC3339Nano), stage)))
			id := fmt.Sprintf("review-%x", sum)
			title := reviewer.i18n.Tf(MsgTaskReviewReturned, it.ID)
			if stage == "overdue" {
				title = reviewer.i18n.Tf(MsgTaskReviewOverdue, it.ID)
			}
			prompt := reviewer.i18n.Tf(MsgTaskReviewPrompt, title, it.What, it.Where, it.ID)
			silent := true
			job := &TimerJob{ID: id, Project: reviewer.name, SessionKey: teamChatKey(it.Chat), ScheduledAt: now,
				Prompt: prompt, Description: title, Silent: &silent, WaitUserQuiet: true, ReplyBoard: it.ID, CreatedAt: now,
				TaskReview: &taskReviewRef{Board: it.ID, ReturnedAt: it.ReturnedAt}}
			if err := reviewer.timerScheduler.addTaskReviewJob(job); err != nil {
				slog.Warn("task review: queue verification failed", "board", it.ID, "error", err)
			}
		}
	}
}

// addTaskReviewJob serializes the two callers (report and periodic watch) around the
// durable timer receipt. Other timer IDs keep their existing behavior.
func (ts *TimerScheduler) addTaskReviewJob(job *TimerJob) error {
	ts.reviewMu.Lock()
	defer ts.reviewMu.Unlock()
	if ts.store.Get(job.ID) != nil {
		return nil
	}
	return ts.AddJob(job)
}
