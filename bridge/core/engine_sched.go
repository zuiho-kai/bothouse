package core

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ExecuteCronJob runs a cron job by injecting a synthetic message into the engine.
// It finds the platform that owns the session key, reconstructs a reply context,
// and processes the message as if the user sent it.
func (e *Engine) ExecuteCronJob(job *CronJob) error {
	// Same as the scheduler (cron.go): a shell job does not use the model (#1492).
	if !job.IsShellJob() {
		if until := e.quotaCoolingFor(e.admissionQuotaScope(e.agent, job.SessionKey)); !until.IsZero() {
			slog.Info("quota cooldown: cron skipped", "project", e.name, "job", job.ID, "cooling_until", until)
			return nil
		}
	}
	if e.IsPaused() {
		return fmt.Errorf("engine %q is paused", e.name)
	}
	if job.Poll && job.IsShellJob() {
		wake, err := e.pollCronJob(job)
		if err != nil || wake == nil {
			return err
		}
		job = wake
	}
	if !job.Mute && isTestJob(job.Description, job.Prompt) {
		// test work never posts in a chat (core/test_noise.go)
		j := *job
		j.Mute = true
		job = &j
		slog.Info("cron: test job runs muted", "job", job.ID, "desc", job.Description)
	}
	// #1857: scheduled prompt jobs go through the proactive outbox — jobs due together for the same
	// chat merge into one run, frequent ones share a per-chat budget and back off when nobody answers.
	var proactiveIDs []string
	if ob := e.outbox(); !job.IsShellJob() && !job.IsEventJob() && ob != nil {
		if ok, why := ob.admit(job, proactiveChat(job.SessionKey)); !ok {
			slog.Info("proactive: cron run skipped", "project", e.name, "job", job.ID, "desc", job.Description, "why", why)
			return nil
		}
		merged, ids := ob.batch(job)
		if merged == nil {
			return nil // joined a run due at the same time; that run does this job too
		}
		job, proactiveIDs = merged, ids
	}
	check := !job.Mute && isCheckJob(job.Description, job.Prompt)
	e.emitEvent(HookEvent{
		Event:      HookEventCronTriggered,
		SessionKey: job.SessionKey,
		Content:    job.Prompt,
		Extra:      map[string]any{"job_id": job.ID, "job_description": job.Description},
	})

	sessionKey := job.SessionKey
	platformName := ""
	if idx := strings.Index(sessionKey, ":"); idx > 0 {
		platformName = sessionKey[:idx]
	}

	var targetPlatform Platform
	for _, p := range e.platforms {
		if p.Name() == platformName {
			targetPlatform = p
			break
		}
	}
	// Fallback: in multi-workspace mode the stored session key may be prefixed
	// with the workspace path (e.g. "/home/user/project:slack:C123:U456").
	// Search for a known platform name within the key and strip the prefix.
	if targetPlatform == nil {
		for _, p := range e.platforms {
			needle := ":" + p.Name() + ":"
			if idx := strings.Index(sessionKey, needle); idx >= 0 {
				targetPlatform = p
				platformName = p.Name()
				sessionKey = sessionKey[idx+1:] // strip workspace prefix
				break
			}
		}
	}
	if targetPlatform == nil {
		return fmt.Errorf("platform %q not found for session %q", platformName, sessionKey)
	}

	rc, ok := targetPlatform.(ReplyContextReconstructor)
	if !ok {
		return fmt.Errorf("platform %q does not support proactive messaging (cron)", platformName)
	}

	runSessionKey := sessionKey
	var replyCtx any
	var err error
	if !job.Mute {
		if resolver, ok := targetPlatform.(CronReplyTargetResolver); ok {
			resolvedSessionKey, resolvedReplyCtx, err := resolver.ResolveCronReplyTarget(sessionKey, cronRunTitle(job))
			if err != nil {
				if !errors.Is(err, ErrNotSupported) {
					return fmt.Errorf("resolve cron reply target: %w", err)
				}
			} else {
				if resolvedSessionKey != "" {
					runSessionKey = resolvedSessionKey
				}
				if resolvedReplyCtx != nil {
					replyCtx = resolvedReplyCtx
				}
			}
		}
	}
	if replyCtx == nil {
		replyCtx, err = rc.ReconstructReplyCtx(runSessionKey)
		if err != nil {
			if !job.Mute || !job.IsShellJob() {
				return fmt.Errorf("reconstruct reply context: %w", err)
			}
			// a muted shell job posts nothing, so it needs no chat to reply in: the setup wizard's wiki jobs on
			// cloud_web are anchored to a session no one chats in (core/setup_wizard.go cloudWebWikiSession)
			replyCtx = nil
		}
	}

	// Wrap platform to discard all outgoing messages when muted
	effectivePlatform := targetPlatform
	if job.Mute {
		effectivePlatform = &mutePlatform{targetPlatform}
	}

	// Notify user that a cron job is executing (unless silent/muted)
	// Note: this notification uses targetPlatform directly, not the tracking wrapper,
	// so it won't count as a "meaningful delivery" for empty response detection.
	// A check job posts no start notice (core/test_noise.go).
	if !job.Mute && !check {
		silent := false
		if e.cronScheduler != nil {
			silent = e.cronScheduler.IsSilent(job)
		}
		if !silent {
			desc := job.Description
			if desc == "" {
				if job.IsShellJob() {
					desc = truncateStr(job.Exec, 40)
				} else {
					desc = truncateStr(job.Prompt, 40)
				}
			}
			e.sendSystemNotice(targetPlatform, replyCtx, fmt.Sprintf("⏰ %s", desc)) // maomao fork: a notice, not the result
		}
	}

	if job.IsShellJob() {
		if check {
			return e.runQuietOKShell(effectivePlatform, replyCtx, job.ID, job.Description, job.SessionKey, job.WorkDir, func(p Platform) error {
				return e.executeCronShell(p, replyCtx, job)
			})
		}
		return e.executeCronShell(effectivePlatform, replyCtx, job)
	}

	content := job.Prompt
	if check {
		content += e.i18n.TPrompt(MsgPromptCheckJob)
	}
	if strings.HasPrefix(content, "/") {
		parts := strings.Fields(content)
		if len(parts) > 0 {
			cmd := strings.ToLower(strings.TrimPrefix(parts[0], "/"))
			if skill := e.skills.Resolve(cmd); skill != nil {
				content = BuildSkillInvocationPrompt(skill, parts[1:])
			}
		}
	}

	msg := &Message{
		turnTrigger:  TurnTriggerCron,
		cronJobID:    job.ID,
		SessionKey:   sessionKey,
		Platform:     platformName,
		UserID:       "cron",
		UserName:     "cron",
		Content:      content,
		ReplyCtx:     replyCtx,
		ModeOverride: job.Mode,
		// maomao fork: a routine turn also gets the summary/wiki/team blocks.
		TurnCtx:      true,
		TurnCtxQuery: content,
		boardLabel:   "⏰ " + boardJobDesc(job.Description, job.Prompt, job.Exec), // maomao fork: channel task board
	}

	// Resolve workspace-specific agent and sessions for multi-workspace mode.
	// Priority: job.WorkDir (explicit) > workspace binding > global agent fallback.
	agent := e.agent
	sessions := e.sessions
	workspaceDir := ""

	if e.multiWorkspace {
		channelID := extractChannelID(sessionKey)
		if channelID != "" {
			workspace, _, err := e.resolveWorkspace(targetPlatform, channelID)
			if err == nil && workspace != "" {
				wsAgent, wsSessions, _, effectiveDir, err := e.workspaceContext(workspace, sessionKey)
				if err == nil {
					agent = wsAgent
					sessions = wsSessions
					workspaceDir = effectiveDir
				}
			}
		}
	}

	if job.WorkDir != "" {
		wsAgent, wsSessions, err := e.getOrCreateWorkspaceAgent(job.WorkDir)
		if err == nil {
			agent = wsAgent
			sessions = wsSessions
			workspaceDir = job.WorkDir
		} else {
			slog.Warn("cron: workspace agent creation failed, using global",
				"work_dir", job.WorkDir, "session_key", sessionKey, "error", err)
		}
	}

	useNewSession := false
	if e.cronScheduler != nil {
		useNewSession = e.cronScheduler.UsesNewSession(job)
	} else {
		useNewSession = job.UsesNewSessionPerRun()
	}

	if useNewSession {
		msg.SessionKey = runSessionKey
		session := sessions.NewSideSession(runSessionKey, "cron-"+job.ID)
		if !session.TryLock() {
			return fmt.Errorf("session %q is busy", runSessionKey)
		}
		// maomao fork: scheduled turns show on the team status board too; a side session gets its own
		// key so it does not replace the main session's entry.
		teamMsg := *msg
		teamMsg.SessionKey = runSessionKey + "#cron:" + session.ID
		e.teamNoteTurn(&teamMsg, session)
		iKey := fmt.Sprintf("%s#cron:%s", runSessionKey, session.ID)
		if workspaceDir != "" {
			iKey = workspaceDir + ":" + iKey
		}
		prevHistLen := session.HistoryLen()
		e.noteScheduledTurn(job.ID, iKey)
		endProactive := e.startProactiveRun(proactiveIDs, sessionKey, runSessionKey, msg.SessionKey)
		e.processInteractiveMessageWith(effectivePlatform, msg, session, agent, sessions, iKey, workspaceDir, runSessionKey)
		endProactive()
		e.forgetScheduledTurn(job.ID, iKey)
		e.cleanupSideRunState(iKey)
		if msg.capacityHeld {
			// deferForCapacity already told the channel this run is skipped.
			slog.Warn("cron: model cooling down, run skipped", "id", job.ID, "session", runSessionKey)
			return nil
		}
		if !job.Mute && turnDelivered(session, prevHistLen) {
			e.proactiveDelivered(proactiveIDs, runSessionKey)
		}
		// Empty-response detection via session history delta: processInteractiveMessageWith
		// always adds a "user" entry (prevHistLen+1), then an "assistant" entry on success
		// (prevHistLen+2). This approach correctly detects empty responses across all
		// delivery modes (plain text, cards, rich cards, DingTalk AI streaming) because
		// AddHistory("assistant",...) is called before any platform-specific rendering path.
		if !job.Mute && session.HistoryLen() < prevHistLen+2 {
			return fmt.Errorf("cron job %q produced an empty response", job.ID)
		}
		return nil
	}

	session := sessions.GetOrCreateActive(sessionKey)
	iKey := sessionKey
	if workspaceDir != "" {
		iKey = workspaceDir + ":" + sessionKey
	}
	if !session.TryLock() {
		// maomao fork: a job that fires while the channel's turn is running waits in the same
		// queue as a user message and runs when that turn ends, instead of being dropped
		// (2026-10-19: 13 of 54 scheduled runs were dropped as "is busy"; user: "我这没看到").
		// Its reply goes to the channel through the queued turn; the job counts as run from here,
		// so the empty-response check below does not apply to it.
		switch e.queueScheduledTurn(effectivePlatform, targetPlatform, msg, session, sessions, iKey, agent, workspaceDir) {
		case queueAccepted:
			slog.Info("cron: session busy, job queued after current turn", "id", job.ID, "session", sessionKey)
			return nil
		case queueRejected:
			return fmt.Errorf("session %q is busy and its queue is full", sessionKey)
		}
		return fmt.Errorf("session %q is busy", sessionKey)
	}
	// maomao fork: scheduled turns show on the team status board too, and see the channel.
	msg.scheduledFrom = targetPlatform
	e.startScheduledTurn(msg, session)

	prevHistLen := session.HistoryLen()
	e.noteScheduledTurn(job.ID, iKey)
	endProactive := e.startProactiveRun(proactiveIDs, sessionKey, runSessionKey)
	e.processInteractiveMessageWith(effectivePlatform, msg, session, agent, sessions, iKey, workspaceDir, sessionKey)
	endProactive()
	e.forgetScheduledTurn(job.ID, iKey)
	if msg.capacityHeld {
		// Held for re-delivery after the cooldown: the job counts as run from here, as a queued one does.
		slog.Warn("cron: model cooling down, run held for re-delivery", "id", job.ID, "session", sessionKey)
		return nil
	}
	if !job.Mute && turnDelivered(session, prevHistLen) {
		e.proactiveDelivered(proactiveIDs, sessionKey)
	}
	// Same empty-response detection as the useNewSession path above.
	if !job.Mute && session.HistoryLen() < prevHistLen+2 {
		return fmt.Errorf("cron job %q produced an empty response", job.ID)
	}
	return nil
}

// ExecuteTimerJob fires a one-shot timer job: resolves the platform, sends a
// notification (unless muted), and either runs a shell command or injects a
// synthetic message into the agent session.
// timerPlatformReadyTimeout bounds how long a due timer waits for an async platform
// (Discord) to connect. Source: local3 patch after 2026-10-23 00:31, when a timer due
// at startup fired before the Discord session existed and the nil session panicked the bridge.
var timerPlatformReadyTimeout = 2 * time.Minute

// errTimerPlatformNotReady marks a timer run skipped because its async platform never
// became ready within timerPlatformReadyTimeout. The scheduler re-queues the job
// instead of marking it fired, so it runs once the platform connects.
var errTimerPlatformNotReady = errors.New("timer platform not ready")

// errTimerQuotaCooling marks a prompt timer run skipped because the model is in a
// quota cooldown: the job did not run, so it must not be recorded as fired (#1492).
var errTimerQuotaCooling = errors.New("timer skipped: provider cooldown")

func (e *Engine) waitTimerPlatformReady(p Platform) error {
	if _, async := p.(AsyncRecoverablePlatform); !async {
		return nil
	}
	deadline := time.Now().Add(timerPlatformReadyTimeout)
	for e.lookupReadyPlatform(p.Name()) == nil {
		if e.ctx.Err() != nil {
			return fmt.Errorf("engine stopping before platform %q was ready", p.Name())
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("platform %q not ready after %s: %w", p.Name(), timerPlatformReadyTimeout, errTimerPlatformNotReady)
		}
		time.Sleep(200 * time.Millisecond) // source: local3 patch poll interval
	}
	return nil
}

// WaitPlatformsReady is for a project loaded into a running service: Start returns before an async
// platform (Discord, cloud_web, …) has connected, so this waits until every async platform reports
// ready. It fails on the first connect error one of them reports (startup would keep retrying in
// the background; a role added from the panel should say why it is not online instead), or when
// one is still not ready after timeout.
func (e *Engine) WaitPlatformsReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		var waiting Platform
		e.platformLifecycleMu.Lock()
		for _, p := range e.platforms {
			if _, async := p.(AsyncRecoverablePlatform); !async || e.platformReady[p] {
				continue
			}
			if err := e.platformConnectErr[p]; err != nil {
				e.platformLifecycleMu.Unlock()
				return fmt.Errorf("platform %s: %w", p.Name(), err)
			}
			waiting = p
			break
		}
		e.platformLifecycleMu.Unlock()
		if waiting == nil {
			return nil
		}
		if e.ctx.Err() != nil {
			return fmt.Errorf("engine stopping before platform %q was ready", waiting.Name())
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("platform %q not connected after %s", waiting.Name(), timeout)
		}
		time.Sleep(200 * time.Millisecond) // source: the poll interval of waitTimerPlatformReady above
	}
}

// PlatformReadyTimeout is how long WaitPlatformsReady is given by hot loading: the same wait a
// timer job gives an async platform (timerPlatformReadyTimeout).
func PlatformReadyTimeout() time.Duration { return timerPlatformReadyTimeout }

// timerTargetPlatform resolves the platform a timer job's session key runs on, as
// ExecuteTimerJob does: nil when this engine has no such platform. The returned
// session key drops a multi-workspace prefix.
func (e *Engine) timerTargetPlatform(sessionKey string) (Platform, string, string) {
	platformName := ""
	if idx := strings.Index(sessionKey, ":"); idx > 0 {
		platformName = sessionKey[:idx]
	}
	for _, p := range e.platforms {
		if p.Name() == platformName {
			return p, platformName, sessionKey
		}
	}
	// Multi-workspace fallback: strip workspace prefix from session key.
	for _, p := range e.platforms {
		needle := ":" + p.Name() + ":"
		if idx := strings.Index(sessionKey, needle); idx >= 0 {
			return p, p.Name(), sessionKey[idx+1:]
		}
	}
	return nil, platformName, sessionKey
}

func (e *Engine) ExecuteTimerJob(job *TimerJob) error {
	if job.TaskReview != nil {
		prepared, err := e.prepareTaskReview(job, time.Now())
		if err != nil {
			return err
		}
		if prepared == nil {
			return nil
		}
		job = e.taskReviewSessionAtRun(prepared)
	}
	job = e.withGuardLiveStatus(job, time.Now()) // #1067: backstop prompt carries team watch's live state
	// A shell job never calls the model, so a model cooldown is no reason to skip it
	// (the scheduler already exempts it, timer.go executeJob). A prompt job is not
	// done when it was skipped: report it, so the scheduler runs it after the
	// cooldown instead of recording it as fired (#1492).
	if !job.IsShellJob() {
		if until := e.quotaCoolingFor(e.admissionQuotaScope(e.agent, job.SessionKey)); !until.IsZero() {
			slog.Info("quota cooldown: timer skipped", "project", e.name, "job", job.ID, "cooling_until", until)
			return errTimerQuotaCooling
		}
	}
	if e.IsPaused() {
		return fmt.Errorf("engine %q is paused", e.name)
	}
	if !job.Mute && !job.Handoff && job.resume == nil && isTestJob(job.Description, job.Prompt) {
		// test work never posts in a chat (core/test_noise.go)
		j := *job
		j.Mute = true
		job = &j
		slog.Info("timer: test job runs muted", "job", job.ID, "desc", job.Description)
	}
	check := !job.Mute && !job.Handoff && job.resume == nil && isCheckJob(job.Description, job.Prompt)
	e.emitEvent(HookEvent{
		Event:      HookEventTimerTriggered,
		SessionKey: job.SessionKey,
		Content:    job.Prompt,
		Extra:      map[string]any{"job_id": job.ID, "job_description": job.Description},
	})

	targetPlatform, platformName, sessionKey := e.timerTargetPlatform(job.SessionKey)
	if targetPlatform == nil {
		return fmt.Errorf("platform %q not found for session %q", platformName, sessionKey)
	}
	if err := e.waitTimerPlatformReady(targetPlatform); err != nil {
		return err
	}

	rc, ok := targetPlatform.(ReplyContextReconstructor)
	if !ok {
		return fmt.Errorf("platform %q does not support proactive messaging (timer)", platformName)
	}

	runSessionKey := sessionKey
	var replyCtx any
	var err error
	if !job.Mute {
		if resolver, ok := targetPlatform.(CronReplyTargetResolver); ok {
			resolvedSessionKey, resolvedReplyCtx, err := resolver.ResolveCronReplyTarget(sessionKey, timerRunTitle(job))
			if err != nil {
				if !errors.Is(err, ErrNotSupported) {
					return fmt.Errorf("resolve timer reply target: %w", err)
				}
			} else {
				if resolvedSessionKey != "" {
					runSessionKey = resolvedSessionKey
				}
				if resolvedReplyCtx != nil {
					replyCtx = resolvedReplyCtx
				}
			}
		}
	}
	if replyCtx == nil {
		replyCtx, err = rc.ReconstructReplyCtx(runSessionKey)
		if err != nil {
			return fmt.Errorf("reconstruct reply context: %w", err)
		}
	}
	replyCtx = e.recordReplyTask(targetPlatform, replyCtx, job.ReplyBoard)

	effectivePlatform := targetPlatform
	if job.Mute {
		effectivePlatform = &mutePlatform{targetPlatform}
	}

	// #1705: the newest channel post before this handoff's start notice; a workspace session that
	// starts a task fresh reads back from there, not the previous task's last 3 hours.
	handoffSeenMark := ""
	if job.Handoff && job.resume == nil {
		handoffSeenMark = newestChannelMsgID(targetPlatform, extractChannelID(sessionKey))
	}

	// Notify user unless muted or silent; a check job posts no start notice (core/test_noise.go)
	if !job.Mute && job.resume == nil && !check { // #624 K4: a resume posts its own notice
		silent := false
		if e.timerScheduler != nil {
			silent = e.timerScheduler.IsSilent(job)
		}
		if !silent {
			desc := job.Description
			if desc == "" {
				if job.IsShellJob() {
					desc = truncateStr(job.Exec, 40)
				} else {
					desc = truncateStr(job.Prompt, 40)
				}
			}
			e.sendSystemNotice(targetPlatform, replyCtx, fmt.Sprintf("⏰ %s", desc)) // maomao fork: a notice, not the result
		}
	}

	if job.IsShellJob() {
		if check {
			return e.runQuietOKShell(effectivePlatform, replyCtx, job.ID, job.Description, job.SessionKey, job.WorkDir, func(p Platform) error {
				return e.executeTimerShell(p, replyCtx, job)
			})
		}
		return e.executeTimerShell(effectivePlatform, replyCtx, job)
	}

	content := job.Prompt
	if check {
		content += e.i18n.TPrompt(MsgPromptCheckJob)
	}
	if strings.HasPrefix(content, "/") {
		parts := strings.Fields(content)
		if len(parts) > 0 {
			cmd := strings.ToLower(strings.TrimPrefix(parts[0], "/"))
			if skill := e.skills.Resolve(cmd); skill != nil {
				content = BuildSkillInvocationPrompt(skill, parts[1:])
			}
		}
	}

	content = timerUserContext(targetPlatform, sessionKey, job) + content
	if !job.Handoff && job.resume == nil {
		content += timerSourceNote // #1188
	}

	msg := &Message{
		turnTrigger:     timerTurnTrigger(job),
		SessionKey:      sessionKey,
		Platform:        platformName,
		UserID:          timerTurnUser(job),
		UserName:        timerTurnUser(job),
		Content:         content,
		ReplyCtx:        replyCtx,
		ModeOverride:    job.Mode,
		boardLabel:      "⏰ " + boardJobDesc(job.Description, job.Prompt, job.Exec), // maomao fork: channel task board
		timerJobID:      job.ID,
		handoffSeenMark: handoffSeenMark,
	}
	// A handoff wake-up (ws-handoff, report bounce, ws-forward) starts or resumes a whole task in a workspace
	// session: give it the same wiki recall, standing practices and decisions a chat turn gets (cron does the
	// same above). The prompt names the handoff file, which is how the gate's context service tells a start.
	if job.Handoff {
		msg.TurnCtx, msg.TurnCtxQuery = true, content
	}
	// #624 K4: a resume delivered through a timer job is the interrupted turn
	// carried on, not a scheduled run.
	if r := job.resume; r != nil {
		msg.turnTrigger = r.trigger
		msg.resumedFrom = r.resumedFrom
		msg.timerJobID = r.timerJobID
		msg.resumeNoProgress = r.noProgress
		msg.resumeFallback = r.fallback
		msg.authorization = r.authorization
		msg.boardLabel = "♻️ " + boardJobDesc(job.Description, job.Prompt, job.Exec)
		if r.authorization != nil && strings.HasPrefix(r.resumedFrom, "admission-") {
			return e.resumeProactiveAdmission(targetPlatform, msg)
		}
	}

	agent := e.agent
	sessions := e.sessions
	workspaceDir := ""

	if e.multiWorkspace {
		channelID := extractChannelID(sessionKey)
		if channelID != "" {
			workspace, _, err := e.resolveWorkspace(targetPlatform, channelID)
			if err == nil && workspace != "" {
				wsAgent, wsSessions, _, effectiveDir, err := e.workspaceContext(workspace, sessionKey)
				if err == nil {
					agent = wsAgent
					sessions = wsSessions
					workspaceDir = effectiveDir
				}
			}
		}
	}

	if job.WorkDir != "" {
		wsAgent, wsSessions, err := e.getOrCreateWorkspaceAgent(job.WorkDir)
		if err == nil {
			agent = wsAgent
			sessions = wsSessions
			workspaceDir = job.WorkDir
		} else {
			slog.Warn("timer: workspace agent creation failed, using global",
				"work_dir", job.WorkDir, "session_key", sessionKey, "error", err)
		}
	}

	useNewSession := false
	if e.timerScheduler != nil {
		useNewSession = e.timerScheduler.UsesNewSession(job)
	} else {
		useNewSession = job.UsesNewSessionPerRun()
	}

	if useNewSession {
		msg.SessionKey = runSessionKey
		session := sessions.NewSideSession(runSessionKey, "timer-"+job.ID)
		if !session.TryLock() {
			return fmt.Errorf("session %q is busy", runSessionKey)
		}
		// maomao fork: scheduled turns show on the team status board too; a side session gets its own
		// key so it does not replace the main session's entry.
		teamMsg := *msg
		teamMsg.SessionKey = runSessionKey + "#timer:" + session.ID
		e.teamNoteTurn(&teamMsg, session)
		iKey := fmt.Sprintf("%s#timer:%s", runSessionKey, session.ID)
		if workspaceDir != "" {
			iKey = workspaceDir + ":" + iKey
		}
		e.noteScheduledTurn(job.ID, iKey)
		e.setTurnModel(iKey, job.Model)
		noteTurnModelIgnored(job, agent, e.name)
		e.processInteractiveMessageWith(effectivePlatform, msg, session, agent, sessions, iKey, workspaceDir, runSessionKey)
		e.setTurnModel(iKey, "")
		e.forgetScheduledTurn(job.ID, iKey)
		e.cleanupSideRunState(iKey)
		return nil
	}

	session := sessions.GetOrCreateActive(sessionKey)
	iKey := sessionKey
	if workspaceDir != "" {
		iKey = workspaceDir + ":" + sessionKey
	}
	if !session.TryLock() {
		// inject_if_busy: fold the prompt into the running turn, the same way a gate mid-turn
		// message is (same checks: canInjectInto); otherwise, or on failure, fall through to queuing.
		// It carries the scheduled-turn mark and sender header a new timer turn would, so it is
		// not taken for something the user just said. A handoff wake-up (#597 G25) never folds in:
		// that path skips the turn setup that opens its own progress card, so it queues instead.
		if job.InjectIfBusy && !job.Handoff && e.canInjectInto(agent, iKey) &&
			e.injectIntoRunningTurn(iKey, e.buildSenderPrompt(withScheduledMark(msg.Content), msg.UserID, msg.UserName, msg.Platform, msg.SessionKey, msg.ChannelKey), msg.ReplyCtx, nil, nil) {
			slog.Info("timer: session busy, job injected into current turn", "id", job.ID, "session", sessionKey)
			return nil
		}
		// maomao fork: queued behind the running turn like a cron job (see ExecuteCronJob).
		switch e.queueScheduledTurn(effectivePlatform, targetPlatform, msg, session, sessions, iKey, agent, workspaceDir) {
		case queueAccepted:
			slog.Info("timer: session busy, job queued after current turn", "id", job.ID, "session", sessionKey)
			return nil
		case queueRejected:
			return fmt.Errorf("session %q is busy and its queue is full", sessionKey)
		}
		return fmt.Errorf("session %q is busy", sessionKey)
	}
	// #1562: a forward into a workspace whose last turn ended with an API error starts fresh.
	if job.Forward {
		if note := e.freshForwardAfterFailure(sessionKey, session, sessions, agent); note != "" {
			msg.Content = note + "\n\n" + msg.Content
		}
	}
	// maomao fork: scheduled turns show on the team status board too, and see the channel.
	if job.resume == nil {
		msg.scheduledFrom = targetPlatform
		e.startScheduledTurn(msg, session)
	} else {
		// A turn resumed after a bridge restart is busy work too: without this note the team
		// status file shows the session idle (sessions:null), and outing-tick keeps queueing
		// into it until the queue is full (2026-10-26). No backfill: the resume prompt has it.
		e.teamNoteTurn(msg, session)
	}

	e.noteScheduledTurn(job.ID, iKey)
	e.processInteractiveMessageWith(effectivePlatform, msg, session, agent, sessions, iKey, workspaceDir, sessionKey)
	e.forgetScheduledTurn(job.ID, iKey)
	return nil
}

// queueScheduledTurn queues a cron/timer (or heartbeat/webhook) turn whose session is busy behind the running turn,
// through the same queue a user message uses. The new_per_run paths never get here: each run
// takes a fresh side session (NewSideSession), which no one else holds, so its TryLock succeeds.
// p is where replies go (muted for a muted job); target is the real platform, for the backfill
// (nil for heartbeat/webhook, which run without one).
func (e *Engine) queueScheduledTurn(p, target Platform, msg *Message, session *Session, sessions *SessionManager, iKey string, agent Agent, workspaceDir string) queueOutcome {
	// Same as the user-message path: a turn that is still starting has no state to queue into yet.
	e.ensureInteractiveStateForQueueing(iKey, p, msg.ReplyCtx)
	return e.queueForBusySession(p, msg, session, sessions, iKey, agent, workspaceDir, target)
}

// startScheduledQueuedTurn gives a queued cron/timer turn, as it starts, what ExecuteCronJob /
// ExecuteTimerJob give one they run directly: the team status note, and the channel posts it
// has not seen with the "（定时任务，回这条）" marker (cronChannelBackfill; 2026-10-17: bots are
// to keep seeing the recent channel messages). A no-op for a user message.
func (e *Engine) startScheduledQueuedTurn(q *queuedMessage, session *Session) {
	if q.scheduledFrom == nil {
		return
	}
	m := queuedToMessage(*q)
	e.startScheduledTurn(&m, session)
	q.content, q.images, q.scheduledBackfilled = m.Content, m.Images, m.scheduledBackfilled
}

// startScheduledTurn is startScheduledQueuedTurn for a Message (a cron/timer turn re-delivered
// after a capacity cooldown). The backfill runs once per job run: after it the posts are marked
// seen and live in msg.Content, which every re-delivery carries, as gate.go does for user messages.
func (e *Engine) startScheduledTurn(msg *Message, session *Session) {
	if msg.scheduledFrom == nil {
		return
	}
	e.teamNoteTurn(msg, session)
	if msg.handoffSeenMark != "" && session.GetLastSeenMsgID() == "" { // #1705
		markSeen(msg.scheduledFrom, session, &Message{MessageID: msg.handoffSeenMark})
	}
	if !msg.scheduledBackfilled {
		e.cronChannelBackfill(msg.scheduledFrom, msg.SessionKey, session, msg)
		msg.scheduledBackfilled = true
	}
}

// setTurnMode ends the previous turn's mode override, if any, and applies mode for the turn
// about to start (maomao fork: a cron/timer job's mode must not carry over to the queued
// messages chained after it).
func (e *Engine) setTurnMode(state *interactiveState, as AgentSession, mode string) {
	e.restoreTurnMode(state)
	state.mu.Lock()
	agent := state.agent
	state.mu.Unlock()
	if restore := e.applyLiveModeOverride(agent, as, mode); restore != nil {
		state.mu.Lock()
		state.modeRestore = restore
		state.turnMode = mode
		state.mu.Unlock()
	}
}

// turnAutoApproves reports whether the permission mode in effect for state's
// current turn already grants every tool call, so permission requests that
// reach the engine without a user to ask (cron/timer turns, background events
// after a turn ends) follow it instead of being denied unconditionally. The
// turn's own override (a cron job's Mode, applied by setTurnMode) wins;
// otherwise the mode of the agent the session actually runs on (a workspace
// agent changed by /mode, not necessarily e.agent).
func (e *Engine) turnAutoApproves(state *interactiveState) bool {
	state.mu.Lock()
	turnMode, agent := state.turnMode, state.agent
	state.mu.Unlock()
	if turnMode != "" {
		return isYoloModeStr(turnMode)
	}
	if agent == nil {
		agent = e.agent
	}
	ma, ok := agent.(interface{ GetMode() string })
	if !ok {
		return false
	}
	return isYoloModeStr(ma.GetMode())
}

// restoreTurnMode switches back to the default mode if a turn's override is still on.
func (e *Engine) restoreTurnMode(state *interactiveState) {
	state.mu.Lock()
	restore := state.modeRestore
	state.modeRestore = nil
	state.turnMode = ""
	state.mu.Unlock()
	if restore != nil {
		restore()
	}
}

// applyLiveModeOverride switches the live agent session to mode and returns the function that
// switches it back to the default mode of agent, the agent the session runs on (a workspace
// agent may differ from e.agent; nil falls back to e.agent); nil when mode is empty or the
// switch did not happen.
func (e *Engine) applyLiveModeOverride(agent Agent, as AgentSession, mode string) (restore func()) {
	if mode == "" || as == nil {
		return nil
	}
	switcher, ok := as.(LiveModeSwitcher)
	if !ok || !switcher.SetLiveMode(mode) {
		return nil
	}
	return func() {
		defaultMode := "default"
		if agent == nil {
			agent = e.agent
		}
		if ma, ok := agent.(interface{ GetMode() string }); ok {
			if m := ma.GetMode(); m != "" {
				defaultMode = m
			}
		}
		switcher.SetLiveMode(defaultMode)
	}
}

func timerRunTitle(job *TimerJob) string {
	if job == nil {
		return "timer"
	}
	if job.Description != "" {
		return job.Description
	}
	if job.IsShellJob() {
		return truncateStr(job.Exec, 40)
	}
	return truncateStr(job.Prompt, 40)
}

// scheduledShellContext returns the context for a cron/timer exec job.
// timeout comes from CronJob/TimerJob.ExecutionTimeout(): 0 means no limit.
func scheduledShellContext(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return context.WithCancel(parent)
	}
	if testHookScheduledShellTimeout != nil {
		timeout = testHookScheduledShellTimeout(timeout)
	}
	return context.WithTimeout(parent, timeout)
}

// testHookScheduledShellTimeout, when set by a test, shortens a scheduled shell job's
// own timeout so the ⏰ ⚠️ timeout branches can be exercised in milliseconds: a
// CronJob/TimerJob ExecutionTimeout is whole minutes (core/cron.go, core/timer.go).
// Production leaves it nil and uses the job's configured timeout unchanged.
var testHookScheduledShellTimeout func(time.Duration) time.Duration

// executeTimerShell runs a shell command for a timer job and sends the output.
func (e *Engine) executeTimerShell(p Platform, replyCtx any, job *TimerJob) error {
	workDir := job.WorkDir
	if workDir == "" {
		if wd, ok := e.agent.(interface{ GetWorkDir() string }); ok {
			workDir = wd.GetWorkDir()
		}
	}
	if workDir == "" {
		workDir, _ = os.Getwd()
	}

	cmdLabel := truncateStr(job.Exec, 60)

	ctx, cancel := scheduledShellContext(e.ctx, job.ExecutionTimeout())
	defer cancel()

	var shellCmd *exec.Cmd
	if runtime.GOOS == "windows" {
		shellCmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", job.Exec)
	} else {
		shellCmd = exec.CommandContext(ctx, "sh", "-c", job.Exec)
	}
	shellCmd.Dir = workDir
	ownScheduledShell(shellCmd)
	scheduledShellDeadline(shellCmd, ctx)

	stdout, err := shellCmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("shell: stdout pipe: %w", err)
	}
	stderr, err := shellCmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("shell: stderr pipe: %w", err)
	}

	if err := shellCmd.Start(); err != nil {
		e.sendSystemNotice(p, replyCtx, fmt.Sprintf("⏰ ❌ `%s`\nerror: failed to start: %v", cmdLabel, err))
		return fmt.Errorf("shell: start: %w", err)
	}

	var mu sync.Mutex
	var buf bytes.Buffer
	doneCh := make(chan struct{})

	readPipe := func(r io.Reader) {
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 0, 64*1024), 64*1024)
		for scanner.Scan() {
			mu.Lock()
			if buf.Len() > 0 {
				buf.WriteByte('\n')
			}
			buf.WriteString(scanner.Text())
			mu.Unlock()
		}
	}
	var pipeWg sync.WaitGroup
	pipeWg.Add(2)
	go func() { defer pipeWg.Done(); readPipe(stdout) }()
	go func() { defer pipeWg.Done(); readPipe(stderr) }()

	go func() {
		pipeWg.Wait()
		_ = shellCmd.Wait()
		close(doneCh)
	}()

	select {
	case <-doneCh:
		return e.finishCronShell(p, replyCtx, shellCmd, &mu, &buf, cmdLabel, job.SessionKey, job.WorkDir)
	case <-ctx.Done():
		killAndWait(shellCmd, doneCh)
		mu.Lock()
		output := buf.String()
		mu.Unlock()
		msg := fmt.Sprintf("⏰ ⚠️ timeout: `%s`", cmdLabel)
		if output != "" {
			msg = fmt.Sprintf("⏰ ⚠️ timeout: `%s`\n\n%s", cmdLabel, truncateStr(output, 3000))
		}
		e.sendSystemNotice(p, replyCtx, msg)
		return fmt.Errorf("shell command timed out")
	case <-time.After(quickFinishTimeout):
	}

	// Long-running command — try in-place updates. A job marked silent (no start
	// notice) announces no ⏳ progress either: a quiet success then posts nothing
	// at all, while failure, timeout and real output still post their result at
	// the end (#1031 review: the silent daily wiki check lit up ⏳→✅ anyway).
	silent := e.timerScheduler != nil && e.timerScheduler.IsSilent(job)

	var previewHandle any
	var useUpdate bool
	if !silent {
		if _, ok := p.(MessageUpdater); ok {
			if starter, ok := p.(PreviewStarter); ok {
				mu.Lock()
				output := buf.String()
				mu.Unlock()
				progressMsg := fmt.Sprintf("⏰ ⏳ `%s`", cmdLabel)
				if output != "" {
					progressMsg = fmt.Sprintf("⏰ ⏳ `%s`\n\n%s", cmdLabel, truncateStr(output, 3000))
				}
				handle, err := starter.SendPreviewStart(e.ctx, replyCtx, progressMsg)
				if err == nil && handle != nil {
					previewHandle = handle
					useUpdate = true
				}
			}
		}
		if !useUpdate {
			e.sendSystemNotice(p, replyCtx, fmt.Sprintf("⏰ ⏳ `%s`", cmdLabel))
		}
	}

	updateDone := make(chan struct{})
	if useUpdate {
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					mu.Lock()
					output := buf.String()
					mu.Unlock()
					msg := fmt.Sprintf("⏰ ⏳ `%s`", cmdLabel)
					if output != "" {
						msg = fmt.Sprintf("⏰ ⏳ `%s`\n\n%s", cmdLabel, truncateStr(output, 3000))
					}
					_ = updaterFor(p).UpdateMessage(e.ctx, previewHandle, msg)
				case <-updateDone:
					return
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	select {
	case <-doneCh:
		close(updateDone)
		if silent {
			// Nothing was announced: the no-opts finish only posts a result, so a
			// quiet success stays quiet end to end.
			return e.finishCronShell(p, replyCtx, shellCmd, &mu, &buf, cmdLabel, job.SessionKey, job.WorkDir)
		}
		return e.finishCronShell(p, replyCtx, shellCmd, &mu, &buf, cmdLabel, job.SessionKey, job.WorkDir, useUpdate, previewHandle)
	case <-ctx.Done():
		close(updateDone)
		killAndWait(shellCmd, doneCh)
		mu.Lock()
		output := buf.String()
		mu.Unlock()
		msg := fmt.Sprintf("⏰ ⚠️ timeout: `%s`", cmdLabel)
		if output != "" {
			msg = fmt.Sprintf("⏰ ⚠️ timeout: `%s`\n\n%s", cmdLabel, truncateStr(output, 3000))
		}
		if useUpdate {
			_ = updaterFor(p).UpdateMessage(e.ctx, previewHandle, msg)
		} else {
			e.sendSystemNotice(p, replyCtx, msg)
		}
		return fmt.Errorf("shell command timed out")
	}
}

func cronRunTitle(job *CronJob) string {
	if job == nil {
		return "cron"
	}
	if desc := strings.TrimSpace(job.Description); desc != "" {
		return truncateStr(desc, 60)
	}
	if job.IsShellJob() {
		if cmd := strings.TrimSpace(job.Exec); cmd != "" {
			return truncateStr(cmd, 60)
		}
		return "cron"
	}
	if prompt := strings.TrimSpace(job.Prompt); prompt != "" {
		return truncateStr(prompt, 60)
	}
	return "cron"
}

// executeCronShell runs a shell command for a cron job and sends the output.
func (e *Engine) executeCronShell(p Platform, replyCtx any, job *CronJob) error {
	workDir := job.WorkDir
	if workDir == "" {
		if wd, ok := e.agent.(interface{ GetWorkDir() string }); ok {
			workDir = wd.GetWorkDir()
		}
	}
	if workDir == "" {
		workDir, _ = os.Getwd()
	}

	cmdLabel := truncateStr(job.Exec, 60)

	ctx, cancel := scheduledShellContext(e.ctx, job.ExecutionTimeout())
	defer cancel()

	shellCmd := shellExecCommand(ctx, e.shell, e.shellFlag, e.shellProfile, job.Exec)
	shellCmd.Dir = workDir
	ownScheduledShell(shellCmd)
	scheduledShellDeadline(shellCmd, ctx)
	if e.dataDir != "" {
		// Shell jobs need the same authoritative storage root as interactive role sessions.
		shellCmd.Env = append(shellCmd.Environ(), "BOTHOUSE_DATA_DIR="+e.dataDir)
	}
	if len(job.eventEnv) > 0 {
		shellCmd.Env = append(shellCmd.Environ(), job.eventEnv...)
	}

	stdout, err := shellCmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("shell: stdout pipe: %w", err)
	}
	stderr, err := shellCmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("shell: stderr pipe: %w", err)
	}

	if err := shellCmd.Start(); err != nil {
		e.sendSystemNotice(p, replyCtx, fmt.Sprintf("⏰ ❌ `%s`\nerror: failed to start: %v", cmdLabel, err))
		return fmt.Errorf("shell: start: %w", err)
	}

	var mu sync.Mutex
	var buf bytes.Buffer
	doneCh := make(chan struct{})

	readPipe := func(r io.Reader) {
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 0, 64*1024), 64*1024)
		for scanner.Scan() {
			mu.Lock()
			if buf.Len() > 0 {
				buf.WriteByte('\n')
			}
			buf.WriteString(scanner.Text())
			mu.Unlock()
		}
	}
	// Use a WaitGroup so both pipe-reader goroutines drain completely before
	// doneCh is closed. Without this, shellCmd.Wait() can return (closing the
	// pipe write-ends) while the scanners still have unread data in the OS
	// buffer, causing finishCronShell to read a truncated output.
	var pipeWg sync.WaitGroup
	pipeWg.Add(2)
	go func() { defer pipeWg.Done(); readPipe(stdout) }()
	go func() { defer pipeWg.Done(); readPipe(stderr) }()

	go func() {
		pipeWg.Wait()
		_ = shellCmd.Wait()
		close(doneCh)
	}()

	// Wait briefly to see if the command finishes quickly
	select {
	case <-doneCh:
		return e.finishCronShell(p, replyCtx, shellCmd, &mu, &buf, cmdLabel, job.SessionKey, job.WorkDir)
	case <-ctx.Done():
		killAndWait(shellCmd, doneCh)
		mu.Lock()
		output := buf.String()
		mu.Unlock()
		msg := fmt.Sprintf("⏰ ⚠️ timeout: `%s`", cmdLabel)
		if output != "" {
			msg = fmt.Sprintf("⏰ ⚠️ timeout: `%s`\n\n%s", cmdLabel, truncateStr(output, 3000))
		}
		e.sendSystemNotice(p, replyCtx, msg)
		return fmt.Errorf("shell command timed out")
	case <-time.After(quickFinishTimeout):
		// Still running — fall through to progress mode
	}

	// Long-running command. Try in-place updates — a job marked silent (no start
	// notice) announces no ⏳ progress either: a quiet success then posts nothing
	// at all, while failure, timeout and real output still post their result at
	// the end (#1031 review: the silent daily wiki check lit up ⏳→✅ anyway).
	silent := e.cronScheduler != nil && e.cronScheduler.IsSilent(job)

	var previewHandle any
	var useUpdate bool
	if !silent {
		if _, ok := p.(MessageUpdater); ok {
			if starter, ok := p.(PreviewStarter); ok {
				mu.Lock()
				output := buf.String()
				mu.Unlock()
				progressMsg := fmt.Sprintf("⏰ ⏳ `%s`", cmdLabel)
				if output != "" {
					progressMsg = fmt.Sprintf("⏰ ⏳ `%s`\n\n%s", cmdLabel, truncateStr(output, 3000))
				}
				handle, err := starter.SendPreviewStart(e.ctx, replyCtx, progressMsg)
				if err == nil && handle != nil {
					previewHandle = handle
					useUpdate = true
				}
			}
		}
		if !useUpdate {
			e.sendSystemNotice(p, replyCtx, fmt.Sprintf("⏰ ⏳ `%s`", cmdLabel))
		}
	}

	updateDone := make(chan struct{})
	if useUpdate {
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					mu.Lock()
					output := buf.String()
					mu.Unlock()
					msg := fmt.Sprintf("⏰ ⏳ `%s`", cmdLabel)
					if output != "" {
						msg = fmt.Sprintf("⏰ ⏳ `%s`\n\n%s", cmdLabel, truncateStr(output, 3000))
					}
					_ = updaterFor(p).UpdateMessage(e.ctx, previewHandle, msg)
				case <-updateDone:
					return
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	select {
	case <-doneCh:
		close(updateDone)
		if silent {
			// Nothing was announced: the no-opts finish only posts a result, so a
			// quiet success stays quiet end to end.
			return e.finishCronShell(p, replyCtx, shellCmd, &mu, &buf, cmdLabel, job.SessionKey, job.WorkDir)
		}
		return e.finishCronShell(p, replyCtx, shellCmd, &mu, &buf, cmdLabel, job.SessionKey, job.WorkDir, useUpdate, previewHandle)
	case <-ctx.Done():
		close(updateDone)
		killAndWait(shellCmd, doneCh)
		mu.Lock()
		output := buf.String()
		mu.Unlock()
		msg := fmt.Sprintf("⏰ ⚠️ timeout: `%s`", cmdLabel)
		if output != "" {
			msg = fmt.Sprintf("⏰ ⚠️ timeout: `%s`\n\n%s", cmdLabel, truncateStr(output, 3000))
		}
		if useUpdate {
			_ = updaterFor(p).UpdateMessage(e.ctx, previewHandle, msg)
		} else {
			e.sendSystemNotice(p, replyCtx, msg)
		}
		return fmt.Errorf("shell command timed out")
	}
}

func (e *Engine) finishCronShell(p Platform, replyCtx any, cmd *exec.Cmd, mu *sync.Mutex, buf *bytes.Buffer, cmdLabel, sessionKey, workDir string, opts ...any) error {
	mu.Lock()
	output := buf.String()
	mu.Unlock()

	exitOK := cmd.ProcessState.ExitCode() == 0

	if exitOK && strings.TrimSpace(output) == "" {
		// A silent success posts no result (user 2026-11-23: every healthy 定时
		// 检查 still dropped a "(no output)" line into the chat, #2104). A run
		// long enough to have announced ⏳ (callers pass opts only then) still
		// closes that line with a bare ✅ — it must not keep looking like it is
		// running. A run that finished inside quickFinishTimeout posts nothing.
		if len(opts) < 2 {
			return nil
		}
		doneMsg := fmt.Sprintf("⏰ ✅ `%s`", cmdLabel)
		if useUpdate, ok := opts[0].(bool); ok && useUpdate {
			if handle := opts[1]; handle != nil {
				if err := updaterFor(p).UpdateMessage(e.ctx, handle, doneMsg); err != nil {
					return err
				}
				e.recordExternalSend(p, sessionKey, workDir, doneMsg, "定时脚本")
				return nil
			}
		}
		e.sendSystemNotice(p, replyCtx, doneMsg)
		return nil
	}

	var finalMsg string
	if exitOK {
		finalMsg = fmt.Sprintf("⏰ ✅ `%s`\n\n%s", cmdLabel, truncateStr(strings.TrimSpace(output), 3000))
	} else {
		errMsg := output
		if errMsg != "" {
			finalMsg = fmt.Sprintf("⏰ ❌ `%s`\n\n%s\n\nerror: exit code %d", cmdLabel, truncateStr(errMsg, 3000), cmd.ProcessState.ExitCode())
		} else {
			finalMsg = fmt.Sprintf("⏰ ❌ `%s`\n\nerror: exit code %d", cmdLabel, cmd.ProcessState.ExitCode())
		}
	}

	if len(opts) >= 2 {
		if useUpdate, ok := opts[0].(bool); ok && useUpdate {
			if handle := opts[1]; handle != nil {
				if err := updaterFor(p).UpdateMessage(e.ctx, handle, finalMsg); err != nil {
					return err
				}
				e.recordExternalSend(p, sessionKey, workDir, finalMsg, "定时脚本")
				if !exitOK {
					return fmt.Errorf("shell: exit code %d", cmd.ProcessState.ExitCode())
				}
				return nil
			}
		}
	}

	if !e.noticeKeptOut(p, replyCtx, finalMsg) {
		if err := e.sendWithError(p, markSystemNotice(p, replyCtx), finalMsg); err != nil {
			return err
		}
		e.recordExternalSend(p, sessionKey, workDir, finalMsg, "定时脚本")
	}
	if !exitOK {
		return fmt.Errorf("shell: exit code %d", cmd.ProcessState.ExitCode())
	}
	return nil
}

// ExecuteHeartbeat runs a heartbeat check by injecting a synthetic message
// into the main session, similar to cron but designed for periodic awareness.
func (e *Engine) ExecuteHeartbeat(sessionKey, prompt string, silent bool) error {
	return e.executeHeartbeatTurn(sessionKey, prompt, silent, "")
}

// executeWake is a silent heartbeat turn that carries a wake ID (#2024, wake_return.go).
func (e *Engine) executeWake(sessionKey, prompt, wakeID string) error {
	return e.executeHeartbeatTurn(sessionKey, prompt, true, wakeID)
}

func (e *Engine) executeHeartbeatTurn(sessionKey, prompt string, silent bool, wakeID string) error {
	runID := heartbeatRunID(sessionKey) // before the workspace prefix is stripped below
	if e.IsPaused() {
		return fmt.Errorf("engine %q is paused", e.name)
	}
	platformName := ""
	if idx := strings.Index(sessionKey, ":"); idx > 0 {
		platformName = sessionKey[:idx]
	}

	var targetPlatform Platform
	for _, p := range e.platforms {
		if p.Name() == platformName {
			targetPlatform = p
			break
		}
	}
	// Fallback: in multi-workspace mode the stored session key may be prefixed
	// with the workspace path (e.g. "/home/user/project:slack:C123:U456").
	// Search for a known platform name within the key and strip the prefix.
	if targetPlatform == nil {
		for _, p := range e.platforms {
			needle := ":" + p.Name() + ":"
			if idx := strings.Index(sessionKey, needle); idx >= 0 {
				targetPlatform = p
				platformName = p.Name()
				sessionKey = sessionKey[idx+1:] // strip workspace prefix
				break
			}
		}
	}
	if targetPlatform == nil {
		return fmt.Errorf("platform %q not found for session %q", platformName, sessionKey)
	}

	rc, ok := targetPlatform.(ReplyContextReconstructor)
	if !ok {
		return fmt.Errorf("platform %q does not support proactive messaging (heartbeat)", platformName)
	}

	replyCtx, err := rc.ReconstructReplyCtx(sessionKey)
	if err != nil {
		return fmt.Errorf("reconstruct reply context: %w", err)
	}

	if !silent {
		e.send(targetPlatform, replyCtx, "💓 heartbeat")
	}

	msg := &Message{
		SessionKey: sessionKey,
		Platform:   platformName,
		UserID:     "heartbeat",
		UserName:   "heartbeat",
		Content:    prompt,
		ReplyCtx:   replyCtx,
		wakeID:     wakeID,
	}

	session := e.sessions.GetOrCreateActive(sessionKey)
	if !session.TryLock() {
		// maomao fork: queued behind the running turn like a cron/timer job (see ExecuteTimerJob),
		// instead of skipping this beat. No scheduledFrom: a direct heartbeat turn has no backfill.
		switch e.queueScheduledTurn(targetPlatform, nil, msg, session, e.sessions, sessionKey, e.agent, "") {
		case queueAccepted:
			slog.Info("heartbeat: session busy, queued after current turn", "session", sessionKey)
			return nil
		case queueRejected:
			return fmt.Errorf("session %q is busy and its queue is full", sessionKey)
		}
		return fmt.Errorf("session %q is busy", sessionKey)
	}

	e.noteScheduledTurn(runID, msg.SessionKey)
	e.processInteractiveMessage(targetPlatform, msg, session)
	e.forgetScheduledTurn(runID, msg.SessionKey)
	return nil
}
