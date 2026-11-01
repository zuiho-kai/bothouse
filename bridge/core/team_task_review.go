package core

import (
	"crypto/sha256"
	"fmt"
	"log/slog"
	"path/filepath"
	"strconv"
	"strings"
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
	Board      int             `json:"board"`
	ReturnedAt time.Time       `json:"returned_at"`
	Stage      string          `json:"stage,omitempty"`
	Items      []taskReviewRef `json:"items,omitempty"`
	Hour       time.Time       `json:"hour,omitempty"`
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

// reconcileTaskReviews shares the workspace watcher and durable timer receipts. Each scan
// chooses one due stage; hourly summaries aggregate by dispatcher and chat.
func (w *handoffWatch) reconcileTaskReviews(now time.Time, roundup bool) {
	e := w.e
	if e.team == nil {
		return
	}
	type group struct {
		reviewer *Engine
		chat     string
		refs     []taskReviewRef
	}
	groups := map[string]*group{}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ReturnedAt.IsZero() || it.Chat == "" {
			// Only a delivered-report receipt proves a legacy handback. Release alone does not.
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
			if x.name == it.Reviewer && x.timerScheduler != nil {
				reviewer = x
				break
			}
		}
		unavailable := reviewer == nil
		if unavailable {
			for _, x := range w.engines() {
				if x.isTeamLead() && x.timerScheduler != nil {
					reviewer = x
					break
				}
			}
		}
		if reviewer == nil {
			continue
		} // board keeps its owner; next scan retries when the role returns.
		it.reviewAfter = reviewer.taskReviewAfter()
		stage := "returned"
		if taskReviewOverdue(it, now) {
			stage = "overdue"
		}
		if unavailable {
			stage = "unavailable"
		}
		sum := sha256.Sum256([]byte(fmt.Sprintf("%s/%d/%s/%s/%s", e.team.dir, it.ID, it.ReturnedAt.Format(time.RFC3339Nano), reviewer.name, stage)))
		id := fmt.Sprintf("review-%x", sum)
		ref := taskReviewRef{Board: it.ID, ReturnedAt: it.ReturnedAt, Stage: stage}
		prior := reviewer.timerScheduler.store.Get(id)
		if prior == nil {
			reviewer.queueTaskReview(id, it.Chat, &ref, now)
		} else if roundup && prior.Fired && prior.ScheduledAt.Before(now.Truncate(teamWorkspaceReconcileEvery)) {
			key := reviewer.name + "/" + it.Chat
			g := groups[key]
			if g == nil {
				g = &group{reviewer: reviewer, chat: it.Chat}
				groups[key] = g
			}
			g.refs = append(g.refs, ref)
		}
	}
	for key, g := range groups {
		hour := now.Truncate(teamWorkspaceReconcileEvery)
		sum := sha256.Sum256([]byte(e.team.dir + "/" + key + "/roundup/" + hour.UTC().Format(time.RFC3339)))
		g.reviewer.queueTaskReview(fmt.Sprintf("review-%x", sum), g.chat, &taskReviewRef{Items: g.refs, Stage: "roundup", Hour: hour}, now)
	}
}

func (e *Engine) queueTaskReview(id, chat string, ref *taskReviewRef, now time.Time) {
	silent := true
	job := &TimerJob{ID: id, Project: e.name, SessionKey: teamChatKey(chat), ScheduledAt: now,
		Silent: &silent, WaitUserQuiet: true, ReplyBoard: ref.Board, CreatedAt: now, TaskReview: ref}
	prepared, err := e.prepareTaskReview(job, now)
	if err != nil {
		slog.Warn("task review: prepare reminder", "error", err)
		return
	}
	if prepared == nil {
		return
	}
	if err := e.timerScheduler.addTaskReviewJob(prepared); err != nil {
		slog.Warn("task review: queue verification failed", "error", err)
	}
}

// Rebuild from the board at execution, including after a queued turn waits behind other work.
// Stale roundups expire at the next hour; stale initial reminders give way to the overdue stage.
func (e *Engine) prepareTaskReview(job *TimerJob, now time.Time) (*TimerJob, error) {
	ref := job.TaskReview
	if ref == nil {
		return job, nil
	}
	if ref.Stage == "roundup" && !now.Before(ref.Hour.Add(teamWorkspaceReconcileEvery)) {
		return nil, nil
	}
	refs := ref.Items
	if len(refs) == 0 {
		refs = []taskReviewRef{*ref}
	}
	var prompts []string
	title := ""
	for _, r := range refs {
		if !e.taskReviewPending(&r) {
			continue
		}
		it := e.boardItemByID(r.Board)
		if it == nil {
			continue
		}
		it.reviewAfter = e.taskReviewAfter()
		if ref.Stage == "returned" && taskReviewOverdue(*it, now) {
			continue
		}
		if r.Stage == "unavailable" {
			available := false
			for _, x := range e.watchEngines() {
				if x.name == it.Reviewer && x.timerScheduler != nil {
					available = true
					break
				}
			}
			if available {
				continue
			}
		}
		t := e.i18n.Tf(MsgTaskReviewReturned, it.ID)
		if taskReviewOverdue(*it, now) {
			t = e.i18n.Tf(MsgTaskReviewOverdue, it.ID)
		}
		if r.Stage == "unavailable" {
			t = e.i18n.Tf(MsgTaskReviewUnavailable, it.ID, it.Reviewer)
		}
		title = t
		prompts = append(prompts, e.i18n.Tf(MsgTaskReviewPrompt, t, it.What, it.Where, it.ID))
	}
	if len(prompts) == 0 {
		return nil, nil
	}
	if ref.Stage == "roundup" {
		title = e.i18n.T(MsgTaskReviewRoundup)
	}
	prompt := strings.Join(prompts, "\n\n")
	root, err := e.leadRuntimeDir()
	if err != nil {
		return nil, err
	}
	if root != "" {
		for _, name := range []string{"board", "ws-handoff"} {
			command := "env GATE_DIR=" + shellQuoteRelay(filepath.Join(root, "gate")) + " " + shellQuoteRelay(filepath.Join(root, "lead", name))
			prompt = strings.ReplaceAll(prompt, name+" ", command+" ")
		}
	}
	copy := *job
	copy.Prompt, copy.Description = prompt, title
	return &copy, nil
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

// The two queue drains share this check: a reminder can wait behind a human turn that
// accepts or rejects the task. Do not start a new agent turn with that obsolete request.
func (e *Engine) refreshQueuedTaskReviewsLocked(state *interactiveState) {
	if e.timerScheduler == nil {
		return
	}
	pending := state.pendingMessages[:0]
	for _, q := range state.pendingMessages {
		job := e.timerScheduler.store.Get(q.timerJobID)
		if job != nil && job.TaskReview != nil {
			prepared, err := e.prepareTaskReview(job, time.Now())
			if err != nil {
				slog.Warn("task review: refresh queued reminder", "error", err)
			} else {
				if prepared == nil {
					continue
				}
				q.content, q.boardDesc = prepared.Prompt, prepared.Description
			}
		}
		pending = append(pending, q)
	}
	state.pendingMessages = pending
}
