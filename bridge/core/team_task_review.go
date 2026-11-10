package core

import (
	"crypto/sha256"
	"fmt"
	"log/slog"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
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
	if it.Deployed != nil {
		return "待上线验收 · 等" + boardLabel(who)
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
			it.Paused != "" || it.Backlog != "" || (it.Dispatcher != e.name && !e.isTeamLead()) {
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
	// Tier the verification was queued for ("complex" or "" = simple). After board tier
	// escalates, a queued simple review no longer applies (taskReviewPending).
	Tier string `json:"tier,omitempty"`
}

func (e *Engine) taskReviewPending(ref *taskReviewRef) bool {
	if e.team == nil {
		return false
	}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ID == ref.Board && ref.Paused != "" {
			return it.Paused != "" && taskPauseKey(it) == ref.Paused
		}
		if it.ID == ref.Board && it.Paused == "" && it.ReviewRejected == "" && it.ReturnedAt.Equal(ref.ReturnedAt) && taskReviewTier(it) == ref.Tier {
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
	// Source: #72 checks merged, explicitly no-deploy work on the existing hourly roundup; #134 ③
	// adds deploy bindings (merged → 等发布) and items waiting on a release (deployed → 待上线验收).
	if roundup && e.isTeamLead() {
		for _, it := range readTeamTaskBoard(e.team.dir) {
			if it.PRBinding != nil && it.PRBinding.Bound == it.Bound && it.PRMerge == nil && it.Paused == "" && it.Backlog == "" {
				if out, err := e.runLeadScript(it.Chat, "board", "merged"); err != nil {
					slog.Warn("task review: merged PR reconciliation failed", "error", err, "output", string(out))
				}
				break
			}
		}
	}
	if roundup && e.isTeamLead() {
		e.markDeployed()
	}
	type group struct {
		reviewer *Engine
		chat     string
		refs     []taskReviewRef
	}
	groups := map[string]*group{}
	load := map[string]int{} // reviews handed to each role in this scan: spread a batch of handbacks
	for _, it := range readTeamTaskBoard(e.team.dir) {
		// A paused item waits for its owner's resume: no hourly reminder, no wake-up
		// (user 11-07 「隔壁这在跑啥」: paused #15/#20 left a card every hour).
		if it.Paused != "" {
			continue
		}
		if it.ReturnedAt.IsZero() || it.Chat == "" {
			// Only a delivered-report receipt proves a legacy handback. Release alone does not.
			if it.Chat != "" && it.ReviewRejected == "" && it.Paused == "" && it.Backlog == "" {
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
		if teamReviewDisabled.Load() {
			// Verification off: a delivered handback closes as done, no reviewer is woken.
			if it.ReviewRejected == "" && e.isTeamLead() {
				if out, err := e.runLeadScript(it.Chat, "board", "done", strconv.Itoa(it.ID), "0", "交回即完成（自动验收已关）"); err != nil {
					slog.Warn("task review: close handback failed", "board", it.ID, "error", err, "output", string(out))
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
		ref := taskReviewRef{Board: it.ID, ReturnedAt: it.ReturnedAt, Stage: stage, Tier: taskReviewTier(it)}
		prior := reviewer.timerScheduler.store.Get(id)
		if prior == nil {
			reviewer.queueTaskReviewIn(id, it.Chat, &ref, now, fresh, taskReviewModelFor(it, reviewer))
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

// teamReviewDisabled: [team_review] disabled = true closes handbacks without a verifier.
var teamReviewDisabled atomic.Bool

// SetTeamReviewDisabled turns automatic handback verification off (bridge-wide).
func SetTeamReviewDisabled(off bool) { teamReviewDisabled.Store(off) }

// teamReviewTiers: the role preferred for each review tier, from [team_review] (bridge-wide,
// updated live from the settings page).
var teamReviewTiers atomic.Pointer[[2]string]

// SetTeamReviewTiers sets the role (project name) that verifies simple and complex handbacks;
// "" leaves that tier to the usual pick.
func SetTeamReviewTiers(simple, complex string) {
	teamReviewTiers.Store(&[2]string{strings.TrimSpace(simple), strings.TrimSpace(complex)})
}

// teamReviewModels: the model each tier's role reviews on, from [team_review] simple_model /
// complex_model ("" = the role's own model).
var teamReviewModels atomic.Pointer[[2]string]

// SetTeamReviewModels sets the model ID the simple and complex tier roles review on (user
// 2026-11-04 13:20「DSH 设置简单/复杂档可直接选模型」); "" keeps the role's own model.
func SetTeamReviewModels(simple, complex string) {
	teamReviewModels.Store(&[2]string{strings.TrimSpace(simple), strings.TrimSpace(complex)})
}

// taskReviewTierModel: the model reviewer runs it on; only the tier's own role, since a model ID
// belongs to that role's agent.
func taskReviewTierModel(it teamTaskBoardItem, reviewer string) string {
	m := teamReviewModels.Load()
	if m == nil || reviewer == "" || reviewer != taskReviewTierRole(it) {
		return ""
	}
	if taskReviewComplex(it) {
		return m[1]
	}
	return m[0]
}

func taskReviewComplex(it teamTaskBoardItem) bool {
	return strings.EqualFold(strings.TrimSpace(it.ReviewTier), "complex") || strings.TrimSpace(it.ReviewTier) == "复杂"
}

// taskReviewTier: "complex" for an escalated handback, "" for the default simple tier.
func taskReviewTier(it teamTaskBoardItem) string {
	if taskReviewComplex(it) {
		return "complex"
	}
	return ""
}

// taskReviewTierRole: the configured role for the item's tier ("" = none).
func taskReviewTierRole(it teamTaskBoardItem) string {
	t := teamReviewTiers.Load()
	if t == nil {
		return ""
	}
	if taskReviewComplex(it) {
		return t[1]
	}
	return t[0]
}

// taskReviewStages: every stage a handback's verification job can have, for finding the job
// already queued for it (taskReviewJobID).
var taskReviewStages = []string{"returned", "overdue", "unavailable"}

func taskReviewJobID(dir string, it teamTaskBoardItem, reviewer, stage string) string {
	key := fmt.Sprintf("%s/%d/%s/%s/%s", dir, it.ID, it.ReturnedAt.Format(time.RFC3339Nano), reviewer, stage)
	if taskReviewComplex(it) {
		key += "/complex" // an escalated handback is a new verification, not the simple one again
	}
	sum := sha256.Sum256([]byte(key))
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
			// The queued review has waited behind the role's own work for a full watch window:
			// hand it to an idle teammate (user 2026-11-04 23:2x「派活的角色忙超过 10 分钟，就转给空着的队友去验收」;
			// window 来源：沿用 watchCheckAfter，团队看门的 10 分钟).
			if !prior.Fired && !prior.UsesNewSessionPerRun() && x.quotaBusy(chat) && !now.Before(prior.ScheduledAt.Add(watchCheckAfter())) {
				x.timerScheduler.RemoveJob(id)
				skip[x.name] = true
				slog.Info("task review: reviewer busy past the watch window, handing the review to an idle role", "board", it.ID, "from", x.name)
				continue
			}
			return x, prior.UsesNewSessionPerRun()
		}
	}
	var tier, designated *Engine
	var pool []*Engine
	tierRole := taskReviewTierRole(it)
	for _, x := range w.engines() {
		if x.timerScheduler == nil || skip[x.name] || taskReviewAuthor(it, x) || x.reviewCooling(chat) {
			continue
		}
		if p, _, _ := x.timerTargetPlatform(chat); p == nil {
			continue // cannot reply on the handback's platform: its timer would fail (platform not found)
		}
		switch x.name {
		case tierRole:
			tier = x
		case it.Reviewer:
			designated = x
		default:
			pool = append(pool, x)
		}
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
	if tier == nil && tierRole != "" && rankTaskReviewStandIns(it, pool, chat) {
		// The tier's role is cooling or wrote the work: the stand-in ranked first (offers the tier
		// model, or is the cheapest for a simple review) reviews, in a side session when busy or on
		// the tier model, like the tier role would.
		x := pool[0]
		return x, taskReviewModelFor(it, x) != "" || x.quotaBusy(chat) || x.taskReviewQueuedIn(chat)
	}
	if tier != nil {
		// The tier's role reviews even when busy (in a new side session): it is the model chosen
		// for this kind of review. Only author or cooling sends the review elsewhere. A chosen
		// tier model always takes a new session: the channel session keeps its own model.
		if taskReviewTierModelID(it) == "" && !tier.quotaBusy(chat) && !tier.taskReviewQueuedIn(chat) {
			return tier, false
		}
		return tier, true
	}
	for _, x := range pool {
		if !x.quotaBusy(chat) && !x.taskReviewQueuedIn(chat) {
			return x, false
		}
	}
	if len(pool) > 0 {
		return pool[0], true
	}
	// Nobody but the author can reply here (a one-role team: the lead dispatched the task to its
	// own workspace): the author reviews in a fresh side session, a clean context apart from the
	// workspace that did the work, instead of the handback waiting forever.
	// 来源：2026-11-10 agentm 只有龙娘一个角色，#15 #26 #27 #29 #35 交回后一直「已交回待验收」。
	for _, x := range w.engines() {
		if x.timerScheduler == nil || skip[x.name] || !taskReviewAuthor(it, x) || x.reviewCooling(chat) {
			continue
		}
		if p, _, _ := x.timerTargetPlatform(chat); p == nil {
			continue
		}
		return x, true
	}
	return nil, false
}

// taskReviewQueuedIn: a review job of e for chat is waiting to run in the channel session, so
// that session is already taken; another review in this batch goes to a free role or a side
// session instead of queueing behind it.
func (e *Engine) taskReviewQueuedIn(chat string) bool {
	for _, j := range e.timerScheduler.store.List() {
		if j.Project == e.name && j.TaskReview != nil && !j.Fired && !j.UsesNewSessionPerRun() && teamChatKey(j.SessionKey) == chat {
			if j.TaskReview.Stage != "roundup" && !e.taskReviewPending(j.TaskReview) {
				continue // superseded (escalated, accepted, rejected): it will not run a turn
			}
			return true
		}
	}
	return false
}

// taskReviewSessionAtRun: the channel session got busy after the review was queued, so the
// review runs in a side session instead of queueing behind that work (user 2026-11-04
// 「新对话来审核」). The hourly roundup keeps the channel session, and so runs on that session's
// model, not a tier model: keeping a conversation and switching its model exclude each other, so
// the roundup's empty model is by design and not an ignored tier model (no notice; #980 review).
func (e *Engine) taskReviewSessionAtRun(job *TimerJob) *TimerJob {
	if job.TaskReview == nil || job.TaskReview.Stage == "roundup" || job.UsesNewSessionPerRun() || !e.quotaBusy(job.SessionKey) {
		return job
	}
	j := *job
	j.SessionMode = "new_per_run"
	return &j
}

func (e *Engine) queueTaskReview(id, chat string, ref *taskReviewRef, now time.Time) {
	e.queueTaskReviewIn(id, chat, ref, now, false, "")
}

// queueTaskReviewIn: fresh runs the verification in a new side session of the role, so a busy
// role reviews without waiting for, or disturbing, the conversation it is working in. model
// (the tier's chosen model) runs that side session on it; it implies fresh.
func (e *Engine) queueTaskReviewIn(id, chat string, ref *taskReviewRef, now time.Time, fresh bool, model string) {
	silent := true
	job := &TimerJob{ID: id, Project: e.name, SessionKey: teamChatKey(chat), ScheduledAt: now,
		Silent: &silent, WaitUserQuiet: true, ReplyBoard: ref.Board, CreatedAt: now, TaskReview: ref}
	if fresh || model != "" {
		job.SessionMode = "new_per_run"
	}
	job.Model = model
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
	if teamReviewDisabled.Load() {
		return nil, nil // queued before the switch: fire as a no-op
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
			// Reminders queued before 11-07 for paused items fire as no-ops.
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
		if !taskReviewComplex(*it) {
			prompts = append(prompts, e.i18n.Tf(MsgTaskReviewEscalate, it.ID))
		}
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
