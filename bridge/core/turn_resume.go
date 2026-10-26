package core

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
)

// Resume after restart (#618 K4). A bridge stopped or killed mid-turn leaves the
// turn in the journal (turn_journal.go). When the first platform of the next
// process is ready, ResumeInterruptedTurns reads what the earlier process left
// and, per entry, either resumes the turn on its agent session (after the
// process the old bridge left running is gone), or drops it (answered meanwhile,
// left to the timer, superseded), or stops and tells the channel (no progress
// over several resumes, or too old).

// Limits; package variables so tests can shorten them.
var (
	// source: reviewed plan M4 (notes/restart-k4-resume.md item 3): give up after 2 resumes without progress.
	turnResumeMaxNoProgress = 2
	// source: notes/restart-k4-resume.md first-handoff design + item 19: older than two hours is not resumed.
	turnResumeMaxAge = 2 * time.Hour
	// source: reviewed plan M4 (item 3): at most 6 resumes at once.
	turnResumeConcurrency = 6
	// source: reviewed plan M4 (item 3): resume starts 10 seconds apart.
	turnResumeStagger = 10 * time.Second
)

const (
	turnResumeStopNoProgress = "重启后续做两次无进展，已停，需要人看"   // item 19
	turnResumeStopTooOld     = "这件活中断超过两小时，没有自动续做，需要人看" // item 19
	turnResumeNotice         = "🔁 桥重启打断了上一轮，接着做"
)

// source: ExecuteTimerJob's description cut (truncateStr(job.Prompt, 40)).
const turnResumeSummaryRunes = 40

// turnResumeDelivery rides on the TimerJob a resume is delivered through
// (ExecuteTimerJob): it turns the job's message into the resumed turn.
type turnResumeDelivery struct {
	resumedFrom string // TurnID of the entry this continues (removed when the new one is written)
	trigger     string // the interrupted turn's trigger, kept
	timerJobID  string
	noProgress  int    // the chain's no-progress count, this resume included
	fallback    string // prompt for a fresh session if the resumed one errors at once (S1)
}

// turnResumeHooks lets tests replace delivery, channel notices and reaping.
type turnResumeHooks struct {
	deliver func(en TurnJournalEntry, job *TimerJob) error
	notify  func(en TurnJournalEntry, text string) error
	reap    func(en TurnJournalEntry) error
	ready   func(en TurnJournalEntry) error // platform wait; nil: waitTurnResumePlatform
	// retryDelay / retryFor override turnResumeRetryDelay / turnResumeRetryFor (tests).
	retryDelay, retryFor time.Duration
}

// turnResumeRetryDelay / turnResumeRetryFor: a resume whose platform is not
// ready or whose channel queue is full is retried in this process (K4 must-fix 3).
var (
	turnResumeRetryDelay = 2 * time.Minute
	turnResumeRetryFor   = turnResumeMaxAge
)

const turnResumeNotDelivered = "重启后这件活没能自动续上（%s），需要人看"

type turnResumeAction int

const (
	turnResumeDrop turnResumeAction = iota
	turnResumeDeliver
	turnResumeStop
	turnResumeLeave // not this block's (bg, relay): left on disk
)

type turnResumePlan struct {
	entry     TurnJournalEntry
	action    turnResumeAction
	stopText  string
	reason    string
	countBump bool // entry.NoProgressCount was raised (a handed-off resume never took over)
}

// turnResumeEnv is what planTurnResumes asks the engine.
type turnResumeEnv struct {
	now       time.Time
	startTime time.Time
	// timerWillRerun: the timer job will fire again by itself (not fired, in grace).
	timerWillRerun func(jobID string) bool
	// repliedBetween: the entry's session got an assistant reply in [from, to).
	repliedBetween func(en TurnJournalEntry, from, to time.Time) bool
}

// planTurnResumes decides, for the entries an earlier process left, what to do
// with each. Pure: entries are copies; the caller applies the plan.
func planTurnResumes(entries []TurnJournalEntry, env turnResumeEnv) []turnResumePlan {
	var plans []turnResumePlan
	superseded := map[string]bool{}
	for _, en := range entries {
		if en.ResumedFrom != "" {
			superseded[en.ResumedFrom] = true
		}
	}
	var candidates []TurnJournalEntry
	for _, en := range entries {
		switch {
		case en.Kind != "" && en.Kind != TurnKindTurn:
			plans = append(plans, turnResumePlan{entry: en, action: turnResumeLeave, reason: "kind " + en.Kind})
		case en.Trigger == "relay" || en.Trigger == "relay_task":
			plans = append(plans, turnResumePlan{entry: en, action: turnResumeLeave, reason: "relay (K6)"})
		case en.Abandoned:
			plans = append(plans, turnResumePlan{entry: en, action: turnResumeDrop, reason: "abandoned earlier"})
		case en.Trigger == TurnTriggerHeartbeat:
			plans = append(plans, turnResumePlan{entry: en, action: turnResumeDrop, reason: "heartbeat"})
		case superseded[en.TurnID]:
			plans = append(plans, turnResumePlan{entry: en, action: turnResumeDrop, reason: "superseded by its resume"})
		default:
			candidates = append(candidates, en)
		}
	}
	// Only the newest entry per chat is resumed; older ones fold into it.
	sort.SliceStable(candidates, func(a, b int) bool { return candidates[a].StartedAt.Before(candidates[b].StartedAt) })
	newest := map[string]int{} // interactive key -> index in candidates
	for i, en := range candidates {
		newest[en.InteractiveKey] = i
	}
	folded := map[int][]string{}
	for i, en := range candidates {
		if n := newest[en.InteractiveKey]; n != i {
			if en.LastUserMessage != "" {
				folded[n] = append(folded[n], en.LastUserMessage)
			}
			folded[n] = append(folded[n], en.QueuedMessages...)
			plans = append(plans, turnResumePlan{entry: en, action: turnResumeDrop, reason: "older entry on the same chat, folded into the newest"})
		}
	}
	for i, en := range candidates {
		if newest[en.InteractiveKey] != i {
			continue
		}
		if f := folded[i]; len(f) > 0 {
			en.QueuedMessages = append(append([]string{}, f...), en.QueuedMessages...)
		}
		p := turnResumePlan{entry: en, action: turnResumeDeliver}
		from := en.InterruptedAt
		if from.IsZero() {
			from = en.StartedAt
		}
		latest := en.StartedAt
		if en.ProgressAt.After(latest) {
			latest = en.ProgressAt
		}
		switch {
		case (en.Trigger == TurnTriggerTimer || en.Trigger == TurnTriggerWorkspace) && en.TimerJobID != "" &&
			env.timerWillRerun != nil && env.timerWillRerun(en.TimerJobID):
			p.action, p.reason = turnResumeDrop, "the timer re-runs the job itself"
		case env.repliedBetween != nil && env.repliedBetween(en, from, env.startTime):
			p.action, p.reason = turnResumeDrop, "a reply came after the interruption"
		default:
			if !en.ResumedAt.IsZero() {
				// Handed off to a resume that never took over (still queued when
				// the bridge went down): that resume counts as one without progress.
				p.entry.NoProgressCount++
				p.countBump = true
			}
			if p.entry.NoProgressCount >= turnResumeMaxNoProgress {
				p.action, p.stopText, p.reason = turnResumeStop, turnResumeStopNoProgress, "no progress"
			} else if env.now.Sub(latest) > turnResumeMaxAge {
				p.action, p.stopText, p.reason = turnResumeStop, turnResumeStopTooOld, "too old"
			}
		}
		plans = append(plans, p)
	}
	return plans
}

// buildTurnResumePrompt is the message the resumed turn sends (#7): what was
// being done, how far it got, check before redoing, and the messages that were
// waiting behind it. withOriginal adds the original message in full (an agent
// that will not see the old context: no session id, or the S1 fresh re-run).
func buildTurnResumePrompt(en TurnJournalEntry, withOriginal bool) string {
	var b strings.Builder
	b.WriteString("（桥重启打断了这一轮）重启前在做：")
	b.WriteString(turnResumeOneLine(en.LastUserMessage, turnResumeSummaryRunes))
	b.WriteString("\n做到：")
	switch {
	case en.LastStep != "" && en.LastText != "":
		b.WriteString("最后一步 " + turnResumeOneLine(en.LastStep, 0) + "；最后输出 " + turnResumeOneLine(en.LastText, 0))
	case en.LastStep != "":
		b.WriteString("最后一步 " + turnResumeOneLine(en.LastStep, 0))
	case en.LastText != "":
		b.WriteString("最后输出 " + turnResumeOneLine(en.LastText, 0))
	default:
		b.WriteString("还没有记录到工具步或输出")
	}
	b.WriteString("\n先核对已有产物再接着做，不要重复已完成的外部动作（push、合 PR、发消息）。")
	if withOriginal && en.LastUserMessage != "" {
		b.WriteString("\n\n原消息全文：\n")
		b.WriteString(en.LastUserMessage)
	}
	if len(en.QueuedMessages) > 0 {
		b.WriteString("\n\n重启时还排着队、没处理的消息（按顺序，一并处理）：")
		for i, m := range en.QueuedMessages {
			fmt.Fprintf(&b, "\n%d. %s", i+1, m)
		}
	}
	return b.String()
}

// turnResumeOneLine folds s onto one line, cut to n runes (n <= 0: no cut).
func turnResumeOneLine(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if n <= 0 {
		return s
	}
	return truncateRunes(s, n)
}

// agentResumesSessions: agents whose session id resumes the old context
// (Claude --resume, Codex resume). Others get the original message in full.
func agentResumesSessions(agentType string) bool {
	switch agentType {
	case "claudecode", "codex":
		return true
	}
	return false
}

// ResumeInterruptedTurns resumes the turns an earlier process left in the
// journal. Run once per process (onPlatformReady, turnResumeOnce); each
// delivery waits for its own platform.
func (e *Engine) ResumeInterruptedTurns() {
	j := e.turnJournalStore()
	if j == nil {
		return
	}
	// M1: agent processes an earlier bridge left behind (parent gone) first,
	// journal or not: a failed write, a deleted entry or a turn that ended
	// during the downtime still leaves orphans. Once per dataDir.
	reapStrayAgentProcesses(e.dataDir, StartTime)
	entries := j.Inherited()
	if len(entries) == 0 {
		return
	}

	plans := planTurnResumes(entries, turnResumeEnv{
		now:            time.Now(),
		startTime:      StartTime,
		timerWillRerun: e.timerWillRerun,
		repliedBetween: e.repliedBetween,
	})
	var deliveries []TurnJournalEntry
	for _, p := range plans {
		en := p.entry
		switch p.action {
		case turnResumeLeave:
			slog.Info("turn resume: left for another part", "turn", en.TurnID, "reason", p.reason)
		case turnResumeDrop:
			slog.Info("turn resume: dropped", "turn", en.TurnID, "key", en.InteractiveKey, "reason", p.reason)
			if err := j.Delete(en.TurnID); err != nil {
				slog.Warn("turn resume: delete failed", "turn", en.TurnID, "error", err)
			}
		case turnResumeStop:
			slog.Warn("turn resume: giving up", "turn", en.TurnID, "key", en.InteractiveKey, "reason", p.reason, "no_progress", en.NoProgressCount)
			if _, err := j.Update(en.TurnID, func(x *TurnJournalEntry) {
				x.Abandoned = true
				x.NoProgressCount = en.NoProgressCount
			}); err != nil {
				slog.Warn("turn resume: mark abandoned failed", "turn", en.TurnID, "error", err)
			}
			go e.stopTurnResume(en, p.stopText)
		case turnResumeDeliver:
			if _, err := j.Update(en.TurnID, func(x *TurnJournalEntry) {
				x.NoProgressCount = en.NoProgressCount
				x.QueuedMessages = en.QueuedMessages // older entries folded in (they are deleted above)
			}); err != nil {
				slog.Warn("turn resume: update failed", "turn", en.TurnID, "error", err)
			}
			deliveries = append(deliveries, en)
		}
	}
	sem := make(chan struct{}, max(1, turnResumeConcurrency))
	for i, en := range deliveries {
		go func(i int, en TurnJournalEntry) {
			if i > 0 && !e.sleepCtx(time.Duration(i)*turnResumeStagger) {
				return
			}
			select {
			case sem <- struct{}{}:
			case <-e.ctx.Done():
				return
			}
			defer func() { <-sem }()
			e.deliverTurnResume(en)
		}(i, en)
	}
}

func (e *Engine) sleepCtx(d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-e.ctx.Done():
		return false
	}
}

// turnResumePlatform is the platform an entry's chat is on.
func (e *Engine) turnResumePlatform(en TurnJournalEntry) Platform {
	name := en.Platform
	if name == "" {
		if i := strings.Index(en.SessionKey, ":"); i > 0 {
			name = en.SessionKey[:i]
		}
	}
	for _, p := range e.platforms {
		if p.Name() == name {
			return p
		}
	}
	return nil
}

// waitTurnResumePlatform waits until the entry's own platform is ready (#17: a
// platform that connects first must not deliver another's resume early).
func (e *Engine) waitTurnResumePlatform(en TurnJournalEntry) error {
	p := e.turnResumePlatform(en)
	if p == nil {
		return fmt.Errorf("platform %q not found", en.Platform)
	}
	return e.waitTimerPlatformReady(p)
}

func (e *Engine) stopTurnResume(en TurnJournalEntry, text string) {
	if err := e.waitTurnResumePlatform(en); err != nil {
		slog.Warn("turn resume: stop notice not sent", "turn", en.TurnID, "error", err)
		return
	}
	if err := e.turnResumeNotify(en, text); err != nil {
		slog.Warn("turn resume: stop notice failed", "turn", en.TurnID, "error", err)
	}
}

func (e *Engine) turnResumeNotify(en TurnJournalEntry, text string) error {
	if e.turnResumeHooks.notify != nil {
		return e.turnResumeHooks.notify(en, text)
	}
	return e.SendToSession(en.SessionKey, text)
}

// deliverTurnResume resumes one entry: its platform ready, the old agent
// process gone, then the resumed turn sent through ExecuteTimerJob.
func (e *Engine) deliverTurnResume(en TurnJournalEntry) {
	j := e.turnJournalStore()
	if j == nil {
		return
	}
	ready := e.turnResumeHooks.ready
	if ready == nil {
		ready = e.waitTurnResumePlatform
	}
	delay, retryFor := turnResumeRetryDelay, turnResumeRetryFor
	if e.turnResumeHooks.retryDelay > 0 {
		delay = e.turnResumeHooks.retryDelay
	}
	if e.turnResumeHooks.retryFor > 0 {
		retryFor = e.turnResumeHooks.retryFor
	}
	giveUp := time.Now().Add(retryFor)
	// retry waits and reports whether to try again; on the last failure it says
	// in the channel why the turn was not resumed.
	retry := func(what string, err error) bool {
		if time.Now().Add(delay).Before(giveUp) && e.sleepCtx(delay) {
			slog.Warn("turn resume: "+what+", retrying", "turn", en.TurnID, "error", err)
			return true
		}
		slog.Warn("turn resume: "+what+", giving up", "turn", en.TurnID, "error", err)
		if e.ctx.Err() == nil {
			if nerr := e.turnResumeNotify(en, fmt.Sprintf(turnResumeNotDelivered, what)); nerr != nil {
				slog.Warn("turn resume: not-delivered notice failed", "turn", en.TurnID, "error", nerr)
			}
		}
		return false
	}
	for {
		err := ready(en)
		if err == nil {
			break
		}
		if !retry("平台未就绪", err) {
			return
		}
	}
	reap := e.turnResumeHooks.reap
	if reap == nil {
		reap = e.reapTurnOrphan
	}
	if err := reap(en); err != nil {
		// Two processes on one agent session would corrupt it: do not resume.
		// The entry stays (not abandoned): once the process is gone the next
		// start can still resume it. Say so in the channel (K4 #13).
		slog.Error("turn resume: old agent process still alive, not resuming", "turn", en.TurnID, "pgid", en.AgentPGID, "error", err)
		if nerr := e.turnResumeNotify(en, "重启前的进程还没退出，这件活没有自动续做，需要人看"); nerr != nil {
			slog.Warn("turn resume: stuck notice failed", "turn", en.TurnID, "error", nerr)
		}
		return
	}
	resumable := agentResumesSessions(en.AgentType) && e.restoreResumeSession(en)
	prompt := buildTurnResumePrompt(en, !resumable)
	fallback := ""
	if resumable {
		fallback = buildTurnResumePrompt(en, true)
	}
	silent := true
	job := &TimerJob{
		ID:          "resume-" + en.TurnID,
		Project:     e.name,
		SessionKey:  en.SessionKey,
		Prompt:      prompt,
		Description: "续做：" + turnResumeOneLine(en.LastUserMessage, turnResumeSummaryRunes),
		Silent:      &silent,
		SessionMode: "reuse",
		Handoff:     en.Trigger == TurnTriggerWorkspace,
		CreatedAt:   time.Now(),
		resume: &turnResumeDelivery{
			resumedFrom: en.TurnID,
			trigger:     en.Trigger,
			timerJobID:  en.TimerJobID,
			noProgress:  en.NoProgressCount + 1, // #16: carried on the chain; only progress clears it
			fallback:    fallback,
		},
	}
	if !e.multiWorkspace && en.WorkspaceDir != "" {
		job.WorkDir = en.WorkspaceDir
	}
	slog.Info("turn resume: resuming", "turn", en.TurnID, "key", en.InteractiveKey, "trigger", en.Trigger, "no_progress", job.resume.noProgress, "resumable", resumable)
	deliver := e.turnResumeHooks.deliver
	if deliver == nil {
		deliver = func(_ TurnJournalEntry, job *TimerJob) error { return e.ExecuteTimerJob(job) }
	}
	noticed := false
	for {
		if !noticed && e.turnResumeHooks.deliver == nil {
			if err := e.turnResumeNotify(en, turnResumeNotice); err != nil {
				slog.Debug("turn resume: notice failed", "turn", en.TurnID, "error", err)
			} else {
				noticed = true
			}
		}
		// ResumedAt marks the hand-off (a resume still queued when the bridge
		// goes down counts as one without progress at the next start); a
		// delivery that failed is rolled back so it is not counted.
		e.markTurnResumed(en.TurnID, time.Now())
		err := deliver(en, job)
		if err == nil {
			return
		}
		e.markTurnResumed(en.TurnID, time.Time{})
		if !retry("投递失败："+turnResumeOneLine(err.Error(), turnResumeSummaryRunes), err) {
			return
		}
	}
}

func (e *Engine) markTurnResumed(turnID string, at time.Time) {
	j := e.turnJournalStore()
	if j == nil {
		return
	}
	if _, err := j.Update(turnID, func(x *TurnJournalEntry) { x.ResumedAt = at }); err != nil {
		slog.Warn("turn resume: mark failed", "turn", turnID, "error", err)
	}
}

// restoreResumeSession makes the entry's chat session resume the agent session
// the turn ran on. The session's own id wins; the entry's is written back only
// when the session has none (a fresh session cut off in its first turn, whose
// id the session store had not saved). False when there is no id to resume.
func (e *Engine) restoreResumeSession(en TurnJournalEntry) bool {
	sessions := e.sessionsForEntry(en)
	if sessions == nil {
		return en.AgentSessionID != ""
	}
	s := sessions.GetOrCreateActive(en.SessionKey)
	if cur := s.GetAgentSessionID(); cur != "" {
		// Delivery reuses the channel's main session. When the turn ran on a
		// different agent session (e.g. a new_per_run timer side session),
		// resuming the main id would continue the wrong conversation: fall back
		// to re-sending the original text instead.
		if en.AgentSessionID != "" && en.AgentSessionID != cur {
			slog.Info("turn resume: not resumable, agent session differs from main session",
				"turn", en.TurnID, "journal_session", en.AgentSessionID, "main_session", cur)
			return false
		}
		return true
	}
	if en.AgentSessionID == "" {
		return false
	}
	s.SetAgentSessionID(en.AgentSessionID, en.AgentType)
	sessions.Save()
	return true
}

func (e *Engine) sessionsForEntry(en TurnJournalEntry) *SessionManager {
	if en.WorkspaceDir != "" {
		if _, sessions, err := e.getOrCreateWorkspaceAgent(en.WorkspaceDir); err == nil {
			return sessions
		}
		return nil
	}
	return e.sessions
}

// timerWillRerun: the timer scheduler fires a job that is not marked fired and
// is within the missed-job grace by itself at start (timer.go Start), so a
// resume would run it twice (#14).
func (e *Engine) timerWillRerun(jobID string) bool {
	if e.timerScheduler == nil || e.timerScheduler.store == nil {
		return false
	}
	job := e.timerScheduler.store.Get(jobID)
	if job == nil || job.Fired {
		return false
	}
	return !job.ScheduledAt.Before(StartTime.Add(-missedJobGracePeriod))
}

// repliedBetween: the entry's chat got an assistant reply in [from, to) (#13,
// #18): it was answered after the interruption; do not resume it.
func (e *Engine) repliedBetween(en TurnJournalEntry, from, to time.Time) bool {
	sessions := e.sessionsForEntry(en)
	if sessions == nil {
		return false
	}
	for _, h := range sessions.GetOrCreateActive(en.SessionKey).GetHistory(0) {
		if h.Role == "assistant" && !h.Timestamp.Before(from) && h.Timestamp.Before(to) {
			return true
		}
	}
	return false
}

// ---- S1: a resumed session that fails at once ----

// armResumeRetry marks the turn starting on state as a resume to watch (S1):
// only when it has a fallback and resumes an existing agent session. A plain
// message clears the mark.
func (e *Engine) armResumeRetry(state *interactiveState, session *Session, fallback string) {
	armed := fallback != "" && session != nil && session.GetAgentSessionID() != ""
	state.mu.Lock()
	state.resumeArmed = armed
	state.resumeFailed, state.resumeFailedQueued = "", nil
	state.mu.Unlock()
}

func recordResumeFailedLocked(state *interactiveState, errMsg string, chained *queuedMessage) {
	if strings.TrimSpace(errMsg) == "" {
		errMsg = "resumed session returned an error"
	}
	state.resumeFailed, state.resumeFailedQueued = errMsg, nil
	if chained != nil {
		q := *chained
		state.resumeFailedQueued = &q
	}
}

// takeResumeFirstResultError reports (and records for the caller) a resumed
// turn whose first result is an error result. It disarms the mark either way.
func (e *Engine) takeResumeFirstResultError(state *interactiveState, input *inputTurn, event Event, chained *queuedMessage) bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	armed := state.resumeArmed
	state.resumeArmed = false
	if !armed || input != nil {
		return false
	}
	if isErr, _ := event.Metadata[MetaResultIsError].(bool); !isErr {
		return false
	}
	// Stop / cancel / capacity / prompt-too-long keep their own paths.
	if state.turnCancelled || e.resumeErrorExcluded(event.Content) {
		return false
	}
	recordResumeFailedLocked(state, event.Content, chained)
	return true
}

// takeResumeFirstError is takeResumeFirstResultError for an EventError.
func (e *Engine) takeResumeFirstError(state *interactiveState, errMsg string, chained *queuedMessage) bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	armed := state.resumeArmed
	state.resumeArmed = false
	if !armed || state.turnCancelled || e.resumeErrorExcluded(errMsg) {
		return false
	}
	recordResumeFailedLocked(state, errMsg, chained)
	return true
}

// resumeErrorExcluded: errors S1 must not treat as a failed resume. A stopping
// bridge keeps the turn for the next start; capacity and prompt-too-long have
// their own retries (runTurnWithCapacityRetry / retryFreshOnPromptTooLong).
func (e *Engine) resumeErrorExcluded(errMsg string) bool {
	return e.isStoppingForJournal() || isModelCapacityError(errMsg) || isPromptTooLongError(errMsg)
}

func (s *interactiveState) takeResumeFailed() (string, *queuedMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	errMsg, q := s.resumeFailed, s.resumeFailedQueued
	s.resumeFailed, s.resumeFailedQueued = "", nil
	return errMsg, q
}

// retryFreshOnResumeError re-runs a resumed turn whose resumed session failed
// at once (S1) on a fresh session, once: the agent session id is cleared, the
// old one handed over (HandoffFrom) when the agent can read it, and the prompt
// carries the original message in full. Must be called with the session
// locked; true when the re-run took over the lock. Otherwise the error is
// reported.
func (e *Engine) retryFreshOnResumeError(p Platform, msg Message, errMsg string, old *interactiveState, session *Session, sessions *SessionManager, agent Agent, interactiveKey, workspaceDir, ccSessionKey string) bool {
	if e.isStoppingForJournal() {
		// Stopping: keep the agent session id so the next start can --resume it.
		slog.Info("resumed turn error during shutdown; not re-running", "session", interactiveKey, "error", errMsg)
		return false
	}
	if msg.resumeFallback == "" || msg.freshRetried {
		e.send(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgError), errMsg))
		return false
	}
	id := session.GetAgentSessionID()
	session.SetAgentSessionID("", agent.Name())
	if id != "" {
		if _, ok := agent.(SessionHandoffReader); ok {
			session.SetHandoffFrom(id, "桥重启后续做旧会话出错")
		}
	}
	sessions.Save()
	slog.Info("turn resume: resumed session failed, re-running on a fresh session", "old_agent_session", id, "error", errMsg)
	e.send(p, markSystemNotice(p, msg.ReplyCtx), "♻️ 续做时旧会话报错，开新会话带上原消息重来一次")
	msg.Content = msg.resumeFallback
	msg.resumeFallback = ""
	return e.rerunOnFreshSession(p, msg, old, session, sessions, agent, interactiveKey, workspaceDir, ccSessionKey)
}

// ---- relay sessions (#8: sessions a relay starts are closed on stop too) ----

type relaySessionSet struct {
	mu   sync.Mutex
	list []AgentSession
}

// trackRelaySession registers an agent session a relay started itself (it is
// not in interactiveStates), so Stop closes it under the same budget and hard
// kill. Dead ones are dropped as new ones come.
func (e *Engine) trackRelaySession(as AgentSession) {
	if as == nil {
		return
	}
	e.relaySessions.mu.Lock()
	defer e.relaySessions.mu.Unlock()
	live := e.relaySessions.list[:0]
	for _, s := range e.relaySessions.list {
		if s != as && s.Alive() {
			live = append(live, s)
		}
	}
	e.relaySessions.list = append(live, as)
}

// takeLiveRelaySessions returns the registered relay sessions still alive and
// clears the registry.
func (e *Engine) takeLiveRelaySessions() []AgentSession {
	e.relaySessions.mu.Lock()
	defer e.relaySessions.mu.Unlock()
	var out []AgentSession
	for _, s := range e.relaySessions.list {
		if s.Alive() {
			out = append(out, s)
		}
	}
	e.relaySessions.list = nil
	return out
}
