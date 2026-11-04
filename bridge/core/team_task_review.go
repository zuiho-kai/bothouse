package core

import (
	"crypto/sha256"
	"fmt"
	"log/slog"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SetTaskReviewAfter configures the existing stuck threshold for handback verification.
func (e *Engine) SetTaskReviewAfter(after time.Duration) { e.teamReviewAfter.Store(int64(after)) }

func (e *Engine) taskReviewAfter() time.Duration {
	if after := time.Duration(e.teamReviewAfter.Load()); after > 0 {
		return after
	}
	return watchCheckAfter() // 来源：#72 沿用团队看门周期，显式配置仍优先。
}

func taskReviewOverdue(it teamTaskBoardItem, now time.Time) bool {
	after := it.reviewAfter
	if after <= 0 {
		after = watchCheckAfter()
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
	if it.PRMerge != nil {
		return "PR已合并 · 待收口 · 等" + boardLabel(who)
	}
	if taskReviewOverdue(it, now) {
		return "没人验收 · 等" + boardLabel(who)
	}
	return "已交回待核对 · 等" + boardLabel(who)
}

func (e *Engine) taskReviewerInfo(project string) (string, time.Duration) {
	for _, x := range e.watchEngines() {
		if x.name == project {
			return x.DisplayName(), x.taskReviewAfter()
		}
	}
	return project, e.taskReviewAfter()
}

// applyRelayBoardReturn consumes dispatch metadata, never a board number in a
// worker's response. The caller serializes task revision changes while applying it.
func (e *Engine) applyRelayBoardReturn(task *Task, request string, receipt taskRelayRecord, board int, bound string, revision int, now time.Time) {
	if e.team == nil || task == nil || task.Agent != e.name || request == "" || bound == "" ||
		revision != task.RevisionNo() || receipt.Status != "done" || receipt.Error != "" ||
		task.State == TaskStateCompleted || task.State == TaskStateCancelled ||
		(task.AssignedProject != "" && task.AssignedProject != e.name) {
		return
	}
	if err := e.CheckTaskAuthorization(task, "task.dispatch"); err != nil {
		return
	}
	chat := task.SessionKey
	if parent, ok := e.WorkspaceParent(chat); ok {
		chat = parent
	}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ID != board || it.Bound != bound || it.Chat == "" || teamChatKey(it.Chat) != teamChatKey(chat) ||
			it.Paused != "" || (it.Dispatcher != e.name && !e.isTeamLead()) {
			continue
		}
		matched := false
		for _, path := range receipt.HandoffRefs {
			matched = matched || (it.Where != "" && path == it.Where)
		}
		if !matched {
			continue
		}
		key := sha256.Sum256([]byte(fmt.Sprintf("%q/%d/%q", task.ID, revision, request)))
		receiptID := fmt.Sprintf("relay-%x", key)
		for _, consumed := range it.RelayReturns {
			if consumed == receiptID {
				return
			}
		}
		if out, err := e.runLeadScript(it.Chat, "board", "returned", strconv.Itoa(it.ID), e.name, now.UTC().Format(time.RFC3339Nano), bound, receiptID); err != nil {
			slog.Warn("task review: relay return failed", "board", it.ID, "error", err, "output", string(out))
		}
		return
	}
}

// Consume committed dispatch links on the existing watch cycle, including after
// restart. Keep revision changes serialized until the board's atomic write has
// checked the captured generation; a snapshot alone would admit stale rework.
func (e *Engine) reconcileRelayBoardReturns(now time.Time) {
	p := e.publicProgress
	if p == nil || e.team == nil {
		return
	}
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	runs := make([]*publicRun, 0, len(p.records))
	for _, r := range p.records {
		runs = append(runs, r)
	}
	p.mu.Unlock()
	for _, r := range runs {
		r.mu.Lock()
		for request, receipt := range r.record.Relays {
			if receipt.Status != "done" {
				continue
			}
			for _, ref := range receipt.BoardRefs {
				e.applyRelayBoardReturn(r.record.Task, request, receipt, ref.Board, ref.Bound, ref.Revision, now)
			}
		}
		r.mu.Unlock()
	}
}

// taskReviewRef ties a persisted timer to one handback. Rework creates a new ReturnedAt;
// an accepted or rejected task invalidates already queued reminders before they run.
type taskReviewRef struct {
	Paused     string          `json:"paused,omitempty"`
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
		if it.ID == ref.Board && ref.Paused != "" {
			return it.Paused != "" && taskPauseKey(it) == ref.Paused
		}
		if it.ID == ref.Board && it.Paused == "" && it.ReviewRejected == "" && it.ReturnedAt.Equal(ref.ReturnedAt) {
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
	for _, source := range w.engines() {
		source.reconcileRelayBoardReturns(now)
	}
	// Source: #72 checks merged, explicitly no-deploy work on the existing hourly roundup.
	if roundup && e.isTeamLead() {
		for _, it := range readTeamTaskBoard(e.team.dir) {
			if it.PRBinding != nil && it.PRBinding.NoDeploy && it.PRBinding.Bound == it.Bound && it.PRMerge == nil && it.Paused == "" {
				if out, err := e.runLeadScript(it.Chat, "board", "merged"); err != nil {
					slog.Warn("task review: merged PR reconciliation failed", "error", err, "output", string(out))
				}
				break
			}
		}
	}
	type group struct {
		reviewer *Engine
		chat     string
		refs     []taskReviewRef
	}
	groups := map[string]*group{}
	load := map[string]int{} // reviews handed to each role in this scan: spread a batch of handbacks
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.Paused != "" {
			if it.Chat == "" {
				continue
			}
			var owner, lead *Engine
			for _, x := range w.engines() {
				if x.timerScheduler == nil {
					continue
				}
				if x.name == it.PausedBy {
					owner = x
				}
				if x.isTeamLead() {
					lead = x
				}
			}
			if owner == nil {
				owner = lead
			}
			if owner == nil {
				continue
			}
			ref := taskReviewRef{Board: it.ID, Paused: taskPauseKey(it), Stage: "paused"}
			at := taskPausedSince(it, now)
			asked := false
			if !at.IsZero() && now.Sub(at) >= teamWorkspaceReconcileEvery {
				ref.Stage = "paused-question"
				sum := sha256.Sum256([]byte(fmt.Sprintf("%s/%d/%s/pause", e.team.dir, it.ID, ref.Paused)))
				id := fmt.Sprintf("review-%x", sum)
				asked = owner.timerScheduler.store.Get(id) == nil
				owner.queueTaskReview(id, it.Chat, &ref, now)
			}
			// The fresh paused-question already covers this item; listing it in the
			// same-scan roundup fired a second identical reminder (11-02 #589/#705 x2).
			if roundup && !asked {
				key := owner.name + "/" + it.Chat
				g := groups[key]
				if g == nil {
					g = &group{reviewer: owner, chat: it.Chat}
					groups[key] = g
				}
				ref.Stage = "paused"
				g.refs = append(g.refs, ref)
			}
			continue
		}
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
		unavailable := true
		for _, x := range w.engines() {
			if x.name == it.Reviewer && x.timerScheduler != nil {
				unavailable = false
				break
			}
		}
		reviewer, fresh := w.pickTaskReviewer(it, load, now)
		if reviewer == nil {
			continue
		} // board keeps its owner; next scan retries when a role is free of cooldown.
		load[reviewer.name]++
		it.reviewAfter = reviewer.taskReviewAfter()
		stage := "returned"
		if taskReviewOverdue(it, now) {
			stage = "overdue"
		}
		if unavailable && it.Reviewer != "" {
			stage = "unavailable"
		}
		id := taskReviewJobID(e.team.dir, it, reviewer.name, stage)
		ref := taskReviewRef{Board: it.ID, ReturnedAt: it.ReturnedAt, Stage: stage}
		prior := reviewer.timerScheduler.store.Get(id)
		if prior == nil {
			reviewer.queueTaskReviewIn(id, it.Chat, &ref, now, fresh)
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

// taskReviewStages: every stage a handback's verification job can have, for finding the job
// already queued for it (taskReviewJobID).
var taskReviewStages = []string{"returned", "overdue", "unavailable"}

func taskReviewJobID(dir string, it teamTaskBoardItem, reviewer, stage string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s/%d/%s/%s/%s", dir, it.ID, it.ReturnedAt.Format(time.RFC3339Nano), reviewer, stage)))
	return fmt.Sprintf("review-%x", sum)
}

// taskReviewAuthor: role x is named in the item's owner text (「工作区1C酱」, 「肥鱼（作者…）」),
// so it wrote or drove the work and must not verify it (user 2026-11-04「作者不审自己」).
// A coordinator named there is excluded too: wrongly skipping a role only narrows the pool.
func taskReviewAuthor(it teamTaskBoardItem, x *Engine) bool {
	if it.Who == "" {
		return false
	}
	return strings.Contains(it.Who, x.name) || strings.Contains(it.Who, x.DisplayName())
}

func (e *Engine) reviewCooling(chat string) bool {
	return e.capacityWait(e.admissionQuotaScope(e.agent, chat)) > 0
}

// pickTaskReviewer chooses who verifies handback it (user 2026-11-04 10:4x: the lead alone cannot
// keep up; hand reviews out, even to a busy role in a new conversation; no fixed cap):
//   - a job already queued for this handback keeps its role, unless that role is cooling and the
//     job has not run: then it is withdrawn and the handback goes to someone else (#112 waited on
//     a role cooling for 624h);
//   - never the author; never a cooling role;
//   - the designated reviewer first, then the role with the fewest reviews handed out this scan;
//     an idle role reviews in its channel session, and when every candidate is busy the first
//     one reviews in a fresh side session (new_per_run) next to its running work.
//
// No candidate (all authors or cooling): nil, the next scan tries again.
func (w *handoffWatch) pickTaskReviewer(it teamTaskBoardItem, load map[string]int, now time.Time) (*Engine, bool) {
	chat := teamChatKey(it.Chat)
	dir := w.e.team.dir
	skip := map[string]bool{}
	back := false // the designated reviewer is present again: an "unavailable" stand-in does not stick
	for _, x := range w.engines() {
		back = back || (it.Reviewer != "" && x.name == it.Reviewer && x.timerScheduler != nil)
	}
	for _, x := range w.engines() {
		if x.timerScheduler == nil {
			continue
		}
		for _, stage := range taskReviewStages {
			if back && stage == "unavailable" {
				continue
			}
			id := taskReviewJobID(dir, it, x.name, stage)
			prior := x.timerScheduler.store.Get(id)
			if prior == nil {
				continue
			}
			if !prior.Fired && x.reviewCooling(chat) {
				x.timerScheduler.RemoveJob(id)
				skip[x.name] = true
				slog.Info("task review: reviewer cooling, handing the review to another role", "board", it.ID, "from", x.name)
				continue
			}
			return x, prior.UsesNewSessionPerRun()
		}
	}
	var designated *Engine
	var pool []*Engine
	for _, x := range w.engines() {
		if x.timerScheduler == nil || skip[x.name] || taskReviewAuthor(it, x) || x.reviewCooling(chat) {
			continue
		}
		if x.name == it.Reviewer {
			designated = x
			continue
		}
		pool = append(pool, x)
	}
	sort.SliceStable(pool, func(i, j int) bool {
		if load[pool[i].name] != load[pool[j].name] {
			return load[pool[i].name] < load[pool[j].name]
		}
		if pool[i].isTeamLead() != pool[j].isTeamLead() {
			return pool[i].isTeamLead()
		}
		return pool[i].name < pool[j].name
	})
	if designated != nil {
		pool = append([]*Engine{designated}, pool...)
	}
	for _, x := range pool {
		if !x.quotaBusy(chat) {
			return x, false
		}
	}
	if len(pool) > 0 {
		return pool[0], true
	}
	return nil, false
}

func (e *Engine) queueTaskReview(id, chat string, ref *taskReviewRef, now time.Time) {
	e.queueTaskReviewIn(id, chat, ref, now, false)
}

// queueTaskReviewIn: fresh runs the verification in a new side session of the role, so a busy
// role reviews without waiting for, or disturbing, the conversation it is working in.
func (e *Engine) queueTaskReviewIn(id, chat string, ref *taskReviewRef, now time.Time, fresh bool) {
	silent := true
	job := &TimerJob{ID: id, Project: e.name, SessionKey: teamChatKey(chat), ScheduledAt: now,
		Silent: &silent, WaitUserQuiet: true, ReplyBoard: ref.Board, CreatedAt: now, TaskReview: ref}
	if fresh {
		job.SessionMode = "new_per_run"
	}
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
		if r.Paused != "" {
			at := taskPausedSince(*it, now)
			span := teamTaskTableSpan(at, now)
			prompts = append(prompts, e.i18n.Tf(MsgTaskPausedSummary, it.ID, it.What, span, it.PauseWhy))
			if r.Stage == "paused-question" {
				prompts = append(prompts, e.i18n.Tf(MsgTaskPausedResumeQuestion, it.ID))
			}
			title = e.i18n.T(MsgTaskReviewRoundup)
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

func taskPauseKey(it teamTaskBoardItem) string {
	if it.PausedAt != "" {
		return it.PausedAt
	}
	return it.Paused
}

func taskPausedSince(it teamTaskBoardItem, now time.Time) time.Time {
	if at, err := time.Parse(time.RFC3339Nano, it.PausedAt); err == nil {
		return at
	}
	at, _ := teamTaskBoardLocal(it.Paused, now)
	return at
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
