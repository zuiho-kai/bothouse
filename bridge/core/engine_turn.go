package core

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// ──────────────────────────────────────────────────────────────
// Interactive agent processing
// ──────────────────────────────────────────────────────────────

func (e *Engine) processInteractiveMessage(p Platform, msg *Message, session *Session) {
	e.processInteractiveMessageWith(p, msg, session, e.agent, e.sessions, msg.SessionKey, "", "")
}

// processInteractiveMessageWith is the core interactive processing loop.
// It accepts an explicit agent, interactiveKey (for the interactiveStates map),
// and workspaceDir so that multi-workspace mode can route to per-workspace agents.
// ccSessionKey, when non-empty, is used for CC_SESSION_KEY in the agent env; otherwise interactiveKey is used.
func (e *Engine) processInteractiveMessageWith(p Platform, msg *Message, session *Session, agent Agent, sessions *SessionManager, interactiveKey string, workspaceDir string, ccSessionKey string) {
	if err := e.checkTurnAuthorization(msg.authorization, "task.resume"); err != nil {
		e.failAuthorizedTurn(msg.authorization)
		session.Unlock()
		slog.Warn("queued turn authorization denied", "error", err)
		return
	}
	if e.IsPaused() {
		session.Unlock()
		msg.inputTurn.finish(inputTurnResult{err: fmt.Errorf("engine %q is paused", e.name)})
		settleWakeReturn(msg.wakeID, "", fmt.Errorf("engine %q is paused", e.name))
		return
	}
	if !e.beginMessageWork() {
		session.Unlock()
		msg.inputTurn.finish(inputTurnResult{err: fmt.Errorf("engine stopped")})
		settleWakeReturn(msg.wakeID, "", fmt.Errorf("engine stopped"))
		return
	}
	defer e.messageWorkers.Done()

	if msg.inputTurn != nil {
		defer msg.inputTurn.finish(inputTurnResult{err: fmt.Errorf("input turn ended without a terminal result")})
	}
	// `cc-connect session new --after-turn`: runs after the unlock below,
	// i.e. once this turn (and anything queued behind it) has replied.
	resetKey := msg.SessionKey
	if ccSessionKey != "" {
		resetKey = ccSessionKey
	}
	// The reset key may differ from this turn's session (a cron/timer turn
	// on a side session injects the main key), so a reset requested from
	// inside the turn checks this count, not only the main session's lock.
	e.beginResetTurn(resetKey)
	defer func() {
		e.endResetTurn(resetKey)
		e.applyPendingReset(resetKey)
		e.applyPendingAutoCompact(interactiveKey, msg.SessionKey, session, sessions, agent, workspaceDir)
	}()
	// session.Unlock() is NOT deferred here — it is called explicitly in
	// the drain loop below while holding state.mu to close the race window
	// between "queue is empty" and "session unlocked". A deferred fallback
	// ensures the lock is released on early-return paths.
	unlocked := false
	defer func() {
		if !unlocked {
			session.Unlock()
		}
	}()

	if e.ctx.Err() != nil {
		return
	}

	// All interactive ingress paths own the session lock here, including
	// no-gate messages, scheduled jobs and capacity redelivery.
	if err := e.applyPendingSwitchOnAgent(agent, interactiveKey, msg.SessionKey, ccSessionKey); err != nil {
		msg.inputTurn.finish(inputTurnResult{err: err})
		e.send(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err.Error()))
		return
	}
	// A relay/side session may have applied a switch while this conversation
	// was idle. Recycle its old process only now, at its next owned turn.
	if msg.inputTurn == nil {
		target := e.admissionQuotaScope(agent, interactiveKey, msg.SessionKey, ccSessionKey)
		e.interactiveMu.Lock()
		old := e.interactiveStates[interactiveKey]
		stale := old != nil && old.agentSession != nil && old.quotaScope != target
		e.interactiveMu.Unlock()
		if stale {
			e.cleanupInteractiveState(interactiveKey, nil)
		}
	}

	turnStart := time.Now()
	origMsg := *msg // maomao fork: re-delivered as-is after a capacity cooldown

	e.i18n.DetectAndSet(msg.Content)
	if !msg.freshRetried { // maomao fork: a prompt-too-long re-run is already in the history
		session.AddHistory("user", msg.Content)
	}
	// Persist user message immediately so crashes between user input and
	// assistant reply don't lose it (the assistant-side Save below depends
	// on the turn completing without a process crash).
	sessions.Save()
	// #618 K1: record the running turn right after its user message is saved,
	// before the agent (cold) starts; a bridge killed mid-turn leaves it on disk.
	journalTurnID := e.journalTurnBegin(msg, interactiveKey, workspaceDir, session)
	if msg.inputTurn == nil {
		e.emitStreamEvent(StreamEventMessage, msg.SessionKey, msg.Content, map[string]any{"user": msg.UserName, "trigger": turnTriggerOf(msg)})
	}
	defer e.journalTurnEnd(journalTurnID)

	// Use the agent override when available (multi-workspace mode)
	var agentOverride Agent
	if agent != e.agent {
		agentOverride = agent
	}
	state := e.getOrCreateInteractiveStateWith(interactiveKey, p, msg.ReplyCtx, session, sessions, agentOverride, ccSessionKey, msg.inputTurn)
	// #1421: messages that queued between this turn being accepted and its
	// journal entry existing had nothing to attach to. enqueueForBusySession
	// syncs through j.Active(interactiveKey), which is empty until
	// journalTurnBegin above, and the drain-time sync (#1399) only runs when
	// the queue is consumed — a shutdown in this window kept the messages in
	// memory, logged them as kept, and wrote none of them to disk, so the
	// restart resumed the turn without them. Now that the entry exists, attach
	// whatever arrived first.
	e.journalSyncQueued(state, interactiveKey)
	if msg.inputTurn != nil {
		state.mu.Lock()
		state.localInputOnly = msg.inputTurn
		state.mu.Unlock()
		defer func() {
			state.mu.Lock()
			if state.localInputOnly == msg.inputTurn {
				state.localInputOnly = nil
			}
			state.mu.Unlock()
		}()
	}

	// Set workspaceDir on the state for idle reaper identification
	if workspaceDir != "" {
		state.mu.Lock()
		state.workspaceDir = workspaceDir
		state.mu.Unlock()
	}

	// Update reply context for this turn
	state.mu.Lock()
	if state.currentMessageID != msg.MessageID {
		state.lastRecallProbeMessageID = ""
		state.lastRecallProbeAt = time.Time{}
		state.recallProbeInFlight = false
	}
	state.platform = p
	state.authorization = msg.authorization
	state.replyCtx = msg.ReplyCtx
	state.injectedReplyCtxs = nil
	state.currentMessageID = msg.MessageID
	state.currentTurnUserMessageTimeMs = msg.UserMessageTimeMs
	state.turnUserID = msg.UserID
	state.markTurnStartLocked()
	state.mu.Unlock()
	state.lastEventAt.Store(time.Now().UnixNano())
	// #699 B: the turn fact every "is this workspace running a turn" reads (team_turn_fact.go).
	// Ends when this function returns, after the drain of the queued messages.
	endTurnFact := beginTeamTurn(teamTurnFact{Chat: msg.SessionKey, Session: msg.SessionKey, Engine: e.name,
		TaskID: e.teamTaskTurnStarted(msg.SessionKey), lastEvent: &state.lastEventAt})
	defer func() {
		endTurnFact()
		// #699 design §4 row 12: the workspace goes back to the pool because its task's state
		// says handed back, when the last turn there has ended — not on a timer after a reply.
		// In its own goroutine: the release talks to the platform under teamWorkspaceOpMu, and
		// a turn's end (and the cron/timer run waiting on it) must not wait behind that
		// (agentm 11-24: cron turns that had replied were recorded as 30-minute timeouts).
		go e.releaseReturnedWorkspace(msg.SessionKey)
	}()
	stopRecallMonitor := e.startMessageRecallMonitor(interactiveKey)
	defer stopRecallMonitor()

	// Read the agent session once, under the lock: cleanupInteractiveState nils state.agentSession
	// under state.mu while this turn runs (idle close, reset, engine stop), and the unlocked
	// re-reads below panicked on nil (#1516, CI run 43195773186 and a local core run, both at the
	// drainEvents call, reached from bounceWorkspaceExit's heartbeat). A session closed meanwhile
	// makes the turn fail through its normal error path instead.
	state.mu.Lock()
	agentSession := state.agentSession
	startErr := state.startErr
	state.mu.Unlock()
	if agentSession == nil {
		msg.inputTurn.finish(inputTurnResult{err: fmt.Errorf("start session: %s", startErr)})
		settleWakeReturn(msg.wakeID, "", fmt.Errorf("start session: %s", startErr))
		text := e.i18n.T(MsgFailedToStartAgentSession)
		if startErr != "" {
			// maomao fork: say why, so whoever reads it can act.
			text += "：" + truncateRunes(startErr, 200)
		}
		e.reply(inputOutputPlatform(p, msg.inputTurn), msg.ReplyCtx, text)
		return
	}
	e.journalTurnAgent(journalTurnID, agentSession)      // #618 K1
	e.armResumeRetry(state, session, msg.resumeFallback) // #618 K4 S1
	e.cancelAgentSessionIdleClose(state)

	if workspaceDir != "" && e.workspacePool != nil {
		ws := e.workspacePool.GetOrCreate(workspaceDir)
		ws.BeginTurn()
		defer ws.EndTurn()
	}

	// Apply per-message permission mode override (e.g. cron jobs with mode = "bypassPermissions").
	// maomao fork: it lasts for this message's turn only; a queued message chained after it gets
	// its own mode (setTurnMode in processInteractiveEvents), and the deferred restore is the
	// fallback for an early return.
	e.setTurnMode(state, agentSession, msg.ModeOverride)
	defer e.restoreTurnMode(state)

	// Start typing indicator if platform supports it.
	// Ownership is transferred to processInteractiveEvents which manages
	// stopping/restarting it across queued message turns.
	var stopTyping func()
	if ti, ok := inputOutputPlatform(p, msg.inputTurn).(TypingIndicator); ok {
		stopTyping = e.startAuthorizedTyping(ti, msg.ReplyCtx, msg.authorization)
	}
	defer func() {
		// Stop typing if ownership was NOT transferred to processInteractiveEvents
		// (i.e. an early return before that call).
		if stopTyping != nil {
			stopTyping()
		}
	}()

	// Stop the unsolicited reader (if running) and hand off event channel
	// ownership to this foreground turn. Only drain events when the previous
	// turn ended abnormally (eventsNeedResync=true, the default).
	e.stopUnsolicitedReader(state)
	state.mu.Lock()
	needResync := state.eventsNeedResync
	state.mu.Unlock()
	if msg.inputTurn != nil {
		strict, ok := agentSession.(StrictResumeSession)
		if !ok {
			msg.inputTurn.finish(inputTurnResult{err: fmt.Errorf("strict resume unsupported")})
			return
		}
		if err := strict.PrepareResumed(msg.inputTurn.expectedID); err != nil {
			msg.inputTurn.finish(inputTurnResult{err: err})
			return
		}
		// A normal exec turn can publish its result before cmd.Wait reports a
		// late error. Drain only after that reader has fully stopped, before
		// starting this turn, so its events can never complete/fail this input.
		needResync = true
	}
	if needResync {
		drainEvents(agentSession.Events())
	}

	// maomao fork: while the model cools down after "at capacity", the message waits
	// for the cooldown instead of reaching the agent. Checked before withTurnBlocks so
	// nothing (wiki pages, team status, handoff) is marked sent for an unsent message.
	// A local input turn (msg.inputTurn) is never deferred: its caller waits on it.
	// A real person's new message asks the model once even while cooling down
	// (2026-11-01: 「复活」之后发一句话就该恢复正常). Bots, cron/timer/heartbeat
	// turns and ws-handoff wake-ups still wait: they are not someone sitting
	// there, and key suffixes alone do not prove where a message came from.
	//
	// The same holds for a quota cooldown: a deadline is a prediction, and a person
	// calling the role is the moment to check it (2026-11-11 用户「我主动去叫正在冷却的人
	// 就会自动解除桥的冷却锁 重新看看能不能正常了」). The turn's own result decides:
	// an answer clears the cooldown (recoverQuotaFor), a quota error records it again.
	capWait := e.capacityWait(state.quotaScope)
	humanAsks := msg.inputTurn == nil && !msg.FromBot &&
		!scheduledTurnUser(msg.UserID) && msg.UserID != "handoff" && !isScheduledSideKey(interactiveKey)
	probeCapacity := capWait > 0 && humanAsks
	// Only a person calling this role (an @, a reply to it, its name at the line
	// start: Message.Mentioned) is that check. A person talking to someone else
	// in the same channel is not asking this role to try again.
	humanCalls := humanAsks && msg.Mentioned
	// One clock read for both the decision and the text: two reads let a deadline that
	// is microseconds away at the check pass before the format, printing 「大约还要 0s」
	// (复核 2026-11-06 观察①).
	now := quotaCoolingNow()
	if until := e.quotaCoolingForAt(state.quotaScope, now); !until.IsZero() && !humanCalls {
		// 用户 2026-11-04 报「没有正确显示什么时候恢复」：不再直接打印 RFC3339，
		// 换成本地时间带偏移量，再按当前时刻算一次大约还要等多久（quota_cooling_display.go）。
		// quotaCoolingForAt 只在截止值还在 now 之后时才返回非零值，
		// 所以这里不需要「未知/已过期」的分支。
		when, wait := quotaCoolingWhen(until), quotaCoolingWait(until, now)
		// #1549：被 @ 派活时不只回一句冷却，把这条活转给同频道空着的队友（quota_reassign.go）。
		if !e.quotaReassignMention(p, msg, until) {
			e.send(p, msg.ReplyCtx, e.i18n.Tf(MsgQuotaCooling, when, wait))
		}
	} else if capWait > 0 && msg.inputTurn == nil && !probeCapacity {
		msg.capacityHeld = true
		e.deferForCapacity(p, origMsg, agent, sessions, interactiveKey, workspaceDir, capWait, true)
	} else {
		// Local copy, not msg.Content: the caller may still read *msg (data race).
		content := session.renderReference(msg.Content, msg.Reference)
		images := msg.Images
		promptContent := content // #2041: a native command is the whole prompt, as typed
		if !msg.nativeCommand {
			if note, imgs := e.freshContextImages(p, session, msg, images); note != "" {
				// maomao fork: first turn of a fresh context gets the recent channel images back.
				content = note + "\n\n" + content
				images = append(imgs, images...)
			}
			content = e.withTurnBlocksRef(session, msg.SessionKey, msg.TurnCtxQuery, msg.TurnCtxSender, content, msg.TurnCtx, msg.Reference)
			// voiceMarked: a merged queue batch already carries its per-part marks, so this
			// turn must not mark the whole text again (#215).
			content = withVoiceNote(content, msg.FromVoice && !msg.voiceMarked)
			promptContent = e.buildSenderPrompt(content, msg.UserID, msg.UserName, msg.Platform, msg.SessionKey, msg.ChannelKey)
			promptContent = e.withSharedMemoryHint(promptContent, agent, msg, workspaceDir)
			promptContent = e.withChannelAgentInstructions(promptContent, msg.UserID, msg.FromBot, p, msg.SessionKey, session, agent)
		}
		// The public-progress run is minted per attempt (beginAttempt): a capacity
		// retry's earlier attempt closed its run when its event loop ended.
		var attemptPrompt string

		sendStart := time.Now()
		state.mu.Lock()
		state.currentMessageID = msg.MessageID
		state.fromVoice = msg.FromVoice
		state.sideText = ""
		state.turnSentTexts = nil
		state.turnSentNonText = false
		state.turnDesc = boardDescOf(msg) // maomao fork: channel task board
		state.turnScheduled = scheduledTurnUser(msg.UserID)
		state.currentJobID = msg.timerJobID
		state.currentWakeID = msg.wakeID
		state.mu.Unlock()
		e.armScheduledTurnTimeout(state, interactiveKey, msg.turnTrigger, msg.timerJobID, msg.cronJobID, msg.UserID, false)
		e.armTurnSpendCap(state, session, interactiveKey, msg.turnTrigger, msg.timerJobID, msg.cronJobID, msg.SessionKey)

		// Run Send concurrently with processInteractiveEvents. Some agents block inside
		// Send until the prompt turn finishes (e.g. ACP session/prompt); they may emit
		// EventPermissionRequest while blocked — the event loop must run in parallel.
		// The agent session is captured under lock per attempt inside runTurnWithCapacityRetry.
		e.runTurnWithCapacityRetry(state, session, sessions, interactiveKey, msg.MessageID, turnStart, stopTyping, msg.ReplyCtx, msg.inputTurn, msg,
			func() {
				state.mu.Lock()
				state.currentJobID = msg.timerJobID // re-armed for a capacity retry
				state.currentWakeID = msg.wakeID
				state.externalTaskInput = msg.externalInput
				state.authorization = msg.authorization
				state.mu.Unlock()
				e.noteCallerTurn(msg.SessionKey, msg.Platform, msg.UserID, msg.UserName, msg.ChannelKey, msg.FromBot, msg.timerJobID != "" || msg.cronJobID != "", msg.inputTurn != nil)
				attemptPrompt = promptContent
				if !msg.nativeCommand {
					attemptPrompt = e.withPublicProgress(promptContent, state, msg.SessionKey, msg.FromBot, msg.FromVoice || msg.inputTurn != nil)
				}
			},
			func(as AgentSession) error {
				if as == nil {
					session.SettleHandoff(false)
					return fmt.Errorf("agent session became nil")
				}
				if err := e.recordTurnAgent(msg.authorization, agent); err != nil {
					return err
				}
				if msg.externalInput != nil {
					if err := msg.externalInput.beforeSend(); err != nil {
						return err
					}
				}
				var err error
				promptContent := attemptPrompt
				if msg.inputTurn != nil {
					if strict, ok := as.(StrictResumeSession); ok {
						err = strict.SendResumed(promptContent, msg.MessageID, sniffImageMimes(images), msg.Files, msg.inputTurn.expectedID)
					} else {
						err = fmt.Errorf("live session does not support strict resume")
					}
				} else {
					err = as.Send(promptContent, msg.MessageID, sniffImageMimes(images), msg.Files)
				}
				session.SettleHandoff(err == nil) // maomao fork: put an undelivered handoff back
				if msg.externalInput != nil {
					err = msg.externalInput.afterSend(err)
				}
				return err
			},
			probeCapacity,
			func(wait time.Duration) {
				// cooling: a probe failed while a cooldown was already running, so
				// the honest notice is "still cooling", not "3 tries failed".
				msg.capacityHeld = true
				e.deferForCapacity(p, origMsg, agent, sessions, interactiveKey, workspaceDir, wait, probeCapacity)
			})
		// Failed local turns can leave queued ordinary messages for the outer
		// drain. Release only this turn's outbound guard before handing them off.
		if msg.inputTurn != nil {
			state.mu.Lock()
			if state.localInputOnly == msg.inputTurn {
				state.localInputOnly = nil
			}
			state.mu.Unlock()
		}
		if elapsed := time.Since(sendStart); elapsed >= slowAgentSend {
			slog.Warn("slow agent send", "elapsed", elapsed, "session", msg.SessionKey, "content_len", len(content))
		}
		stopTyping = nil // ownership transferred; prevent defer from double-stopping
		// maomao fork: the provider refused the prompt as too long; re-run on a fresh session.
		if errMsg, q := state.takePromptTooLong(); errMsg != "" {
			retryP, retry := p, origMsg
			if q != nil {
				retryP, retry = q.platform, queuedToMessage(*q)
			}
			if e.retryFreshOnPromptTooLong(retryP, retry, errMsg, state, session, sessions, agent, interactiveKey, workspaceDir, ccSessionKey) {
				unlocked = true
				return
			}
		}
		// #618 K4 S1: the resumed session failed at once; re-run on a fresh one.
		if errMsg, q := state.takeResumeFailed(); errMsg != "" {
			retryP, retry := p, origMsg
			if q != nil {
				retryP, retry = q.platform, queuedToMessage(*q)
			}
			if e.retryFreshOnResumeError(retryP, retry, errMsg, state, session, sessions, agent, interactiveKey, workspaceDir, ccSessionKey) {
				unlocked = true
				return
			}
		}
		// #1414: the upstream classifier refused the turn; re-run once on a fresh session.
		if errMsg, q := state.takeRefused(); errMsg != "" {
			retryP, retry := p, origMsg
			if q != nil {
				retryP, retry = q.platform, queuedToMessage(*q)
			}
			if e.retryFreshOnRefusal(retryP, retry, errMsg, state, session, sessions, agent, interactiveKey, workspaceDir, ccSessionKey) {
				unlocked = true
				return
			}
		}
		// #1562: a workspace turn on a cheap lane ended with an API error; re-run on the lead model.
		if errMsg, q := state.takeCheapFailed(); errMsg != "" {
			retryP, retry := p, origMsg
			if q != nil {
				retryP, retry = q.platform, queuedToMessage(*q)
			}
			if e.retryOnLeadAfterCheapFailure(retryP, retry, errMsg, state, session, sessions, agent, interactiveKey, workspaceDir, ccSessionKey) {
				unlocked = true
				return
			}
		}
	}

	// Guard against a narrow race: a message may have been queued between
	// processInteractiveEvents observing an empty queue and returning here
	// (session is still locked, so handleMessage's TryLock fails and routes
	// the message to queueMessageForBusySession). Drain any such orphans.
	if e.drainPendingMessages(state, session, sessions, interactiveKey) {
		unlocked = true
	}
}

// getOrCreateWorkspaceAgent returns (or creates) a per-workspace agent and session manager.
// workspace must be a normalized path (from resolveWorkspace or normalizeWorkspacePath).
func (e *Engine) getOrCreateWorkspaceAgent(workspace string) (Agent, *SessionManager, error) {
	e.interactiveMu.Lock()
	if e.workspacePool == nil {
		e.workspacePool = newWorkspacePool(DefaultWorkspaceIdleTimeout)
	}
	pool := e.workspacePool
	e.interactiveMu.Unlock()

	ws := pool.GetOrCreate(workspace)
	ws.mu.Lock()
	defer ws.mu.Unlock()

	if ws.agent != nil {
		return ws.agent, ws.sessions, nil
	}

	// Create a new agent instance with this workspace's work_dir
	opts := make(map[string]any)
	// Let the agent seed its own base options (e.g. tmux session name)
	if snapshotter, ok := e.agent.(WorkspaceAgentOptionSnapshotter); ok {
		for k, v := range snapshotter.WorkspaceAgentOptions() {
			opts[k] = v
		}
	}

	// workspace-specific overrides always win
	opts["work_dir"] = workspace

	if e.projectState != nil {
		if m := e.projectState.WorkspaceModelOverride(workspace); m != "" {
			opts["model"] = m
		}
	}

	// Copy model from original agent if possible
	if _, ok := opts["model"]; !ok {
		if ma, ok := e.agent.(interface{ GetModel() string }); ok {
			if m := ma.GetModel(); m != "" {
				opts["model"] = m
			}
		}
	}
	// Copy permission mode
	if _, ok := opts["mode"]; !ok {
		if ma, ok := e.agent.(interface{ GetMode() string }); ok {
			if m := ma.GetMode(); m != "" {
				opts["mode"] = m
			}
		}
	}
	// Copy run_as_user (and run_as_env) for OS-level isolation. Without
	// this, per-workspace agents silently bypass the project-level
	// run_as_user config because their opts map is freshly constructed
	// above, not inherited from the project-level opts that main.go
	// already decorated. See cc-connect#496 and the cc-connect/core/runas.go
	// preamble for why run_as_user has to survive this copy.
	if _, ok := opts["run_as_user"]; !ok {
		if u := e.runAsUser(); u != "" {
			opts["run_as_user"] = u
		}
	}
	if _, ok := opts["run_as_env"]; !ok {
		if ma, ok := e.agent.(interface{ GetRunAsEnv() []string }); ok {
			if env := ma.GetRunAsEnv(); len(env) > 0 {
				opts["run_as_env"] = env
			}
		}
	}

	agent, err := CreateAgent(e.agent.Name(), opts)
	if err != nil {
		return nil, nil, fmt.Errorf("create workspace agent for %s: %w", workspace, err)
	}

	// Wire providers if original agent has them
	if ps, ok := e.agent.(ProviderSwitcher); ok {
		if ps2, ok2 := agent.(ProviderSwitcher); ok2 {
			ps2.SetProviders(ps.ListProviders())
			if active := ps.GetActiveProvider(); active != nil && active.Name != "" {
				ps2.SetActiveProvider(active.Name)
			}
		}
	}

	// Create per-workspace session manager
	h := sha256.Sum256([]byte(workspace))
	sessionFile := filepath.Join(filepath.Dir(e.sessions.StorePath()),
		fmt.Sprintf("%s_ws_%s.json", e.name, hex.EncodeToString(h[:4])))
	sessions := NewSessionManager(sessionFile)

	ws.agent = agent
	ws.sessions = sessions
	return agent, sessions, nil
}

func (e *Engine) resolveChannelWorkDir(workspace, interactiveKey string) string {
	if e.projectState == nil {
		return workspace
	}
	override := e.projectState.WorkspaceDirOverride(interactiveKey)
	if override == "" {
		return workspace
	}
	if info, err := os.Stat(override); err == nil && info.IsDir() {
		return override
	}
	e.projectState.ClearWorkspaceDirOverride(interactiveKey)
	e.projectState.Save()
	return workspace
}

func (e *Engine) workspaceContext(workspace, sessionKey string) (Agent, *SessionManager, string, string, error) {
	interactiveKey := workspace + ":" + sessionKey
	effectiveDir := e.resolveChannelWorkDir(workspace, interactiveKey)
	wsAgent, wsSessions, err := e.getOrCreateWorkspaceAgent(effectiveDir)
	if err != nil {
		return nil, nil, "", "", err
	}
	return wsAgent, wsSessions, interactiveKey, effectiveDir, nil
}

// getOrCreateInteractiveStateWith accepts an optional agent override for multi-workspace mode.
// adoptPendingFromPlaceholder copies pendingMessages from an existing placeholder
// state to newState so queued messages are not lost when the map entry is replaced.
// Must be called under interactiveMu.
func adoptPendingFromPlaceholder(existing, newState *interactiveState) {
	if existing == nil || existing == newState {
		return
	}
	existing.mu.Lock()
	if existing.approveAll {
		newState.approveAll = true
	}
	if len(existing.pendingMessages) > 0 {
		newState.pendingMessages = existing.pendingMessages
		existing.pendingMessages = nil
	}
	existing.mu.Unlock()
}

// When agentOverride is non-nil it is used instead of e.agent to start the session.
// ccSessionKey, when non-empty, is used for CC_SESSION_KEY env injection; otherwise sessionKey is used.
func (e *Engine) getOrCreateInteractiveStateWith(sessionKey string, p Platform, replyCtx any, session *Session, sessions *SessionManager, agentOverride Agent, ccSessionKey string, inputs ...*inputTurn) *interactiveState {
	ccKey := sessionKey
	if ccSessionKey != "" {
		ccKey = ccSessionKey
	}
	settings := e.sessionSettingsFor(ccKey)
	if m := e.turnModelFor(sessionKey); m != "" {
		settings.Model = m // a review side turn on its tier model (TimerJob.Model)
		settings.Provider = ""
	}
	if settings.Provider != "" {
		slog.Info("workspace exec: session starts on workspace provider", "session", ccKey, "provider", settings.Provider, "model", settings.Model)
	}
	e.interactiveMu.Lock()
	var input *inputTurn
	if len(inputs) > 0 {
		input = inputs[0]
	}
	if input != nil && (input.expectedID == "" || session.GetAgentSessionID() != input.expectedID || sessions.ActiveSessionID(ccSessionKey) != session.ID) {
		e.interactiveMu.Unlock()
		return &interactiveState{startErr: "original session binding changed"}
	}

	state, ok := e.interactiveStates[sessionKey]
	for ok && (state.agentCloseDone != nil || state.agentStartDone != nil) {
		closed := state.agentCloseDone
		started := state.agentStartDone
		e.interactiveMu.Unlock()
		if closed != nil {
			select {
			case <-closed:
			case <-e.ctx.Done():
				e.interactiveMu.Lock()
				defer e.interactiveMu.Unlock()
				return &interactiveState{startErr: "engine stopped while closing the previous process"}
			}
		} else if started != nil {
			select {
			case <-started:
			case <-e.ctx.Done():
				e.interactiveMu.Lock()
				defer e.interactiveMu.Unlock()
				return &interactiveState{startErr: "engine stopped while starting the process"}
			}
		}
		e.interactiveMu.Lock()
		if e.interactiveStates[sessionKey] == state {
			if state.agentCloseDone == closed {
				state.agentCloseDone = nil
			}
		}
		state, ok = e.interactiveStates[sessionKey]
	}
	if ok && state.agentSession != nil && state.agentSession.Alive() {
		// Claim under the same map lock the closer uses. Cancelling later in the
		// foreground worker leaves a window in which cleanup can close this process.
		e.cancelAgentSessionIdleClose(state)
		// Verify the running agent session matches the current active session.
		// After /new or /switch the active session changes, but the old agent
		// process may still be alive. Reusing it would send messages to the
		// wrong conversation context.
		wantID := session.GetAgentSessionID()
		currentID := state.agentSession.CurrentSessionID()
		// Reuse only when the live process matches what the Session expects:
		// - IDs match (same Claude session), or
		// - the process has not reported an ID yet (startup; empty want is OK).
		// If wantID is empty (/new, cleared session) but the process already has
		// a concrete ID, reusing would keep --resume context — recycle (#238).
		needRecycle := (currentID != "" && (wantID == "" || wantID != currentID)) || state.modelSettings != settings
		if input != nil {
			_, supported := state.agentSession.(StrictResumeSession)
			if !supported || currentID != input.expectedID {
				e.interactiveMu.Unlock()
				return &interactiveState{startErr: "live session cannot strictly resume the original binding"}
			}
		}
		if input == nil && !needRecycle && currentID != "" && currentID == wantID {
			// maomao fork: the live process has piled up images; recycle it
			// into a fresh context with a handoff.
			agent := e.agent
			if agentOverride != nil {
				agent = agentOverride
			}
			e.noteContextWindow(currentID, state.agentSession)
			notice := e.freshOnContextSize(agent, session, contextFreshChat(p, sessionKey))
			if notice == "" {
				notice = e.freshOnImageBloat(agent, session)
			}
			if notice != "" {
				sessions.Save()
				go e.sendFreshNotice(p, replyCtx, sessionKey, notice)
				wantID, needRecycle = "", true
			}
		}
		restartForTask := false
		if input == nil && !needRecycle && e.staleHandoffEnv(ccKey, state.handoffID) {
			// The process was started outside the task now in work in this workspace; its
			// CC_HANDOFF is fixed. Start it again (same agent session) for that task.
			slog.Info("interactive session: started outside the workspace's task in work, restarting it for that task",
				"session_key", sessionKey, "had_handoff", state.handoffID)
			needRecycle, restartForTask = true, true
		}
		if !needRecycle {
			state.mu.Lock()
			state.processClaimed = true
			state.mu.Unlock()
			e.interactiveMu.Unlock()
			return state
		}
		// Tear down the stale agent so we start one that matches the Session below.
		slog.Info("interactive session mismatch, recycling",
			"session_key", sessionKey,
			"want_agent_session", wantID,
			"have_agent_session", currentID,
		)
		e.stopUnsolicitedReader(state)
		state.markStopped()
		// Close synchronously to prevent race condition where old agent
		// continues outputting while new agent starts (issue #327).
		if rc, isRestartCloser := state.agentSession.(AgentSessionRestartCloser); restartForTask && isRestartCloser {
			// A process alive here was kept for its background work and does not
			// leave on stdin close; the task's first turn must not wait that out.
			e.closeAgentSessionBy(sessionKey, state.agentSession, nil, rc.CloseForRestart)
		} else {
			e.closeAgentSessionWithTimeout(sessionKey, state.agentSession)
		}
		delete(e.interactiveStates, sessionKey)
		ok = false // prevent reading stale settings below
	}

	// Select the agent to use for this session
	agent := e.agent
	if agentOverride != nil {
		agent = agentOverride
	}

	// Inject per-session env vars so the agent subprocess can call `cc-connect cron add` etc.
	env := e.roleSessionEnv(ccKey)
	handoffID := roleEnvValue(env, "CC_HANDOFF") // kept for an agent that takes no env too, so it is not restarted every turn (staleHandoffEnv)
	if inj, ok := agent.(SessionEnvInjector); ok {
		inj.SetSessionEnv(append(env, "CC_AGENT="+agent.Name()))
	}
	e.applySessionModel(agent, ccKey)
	if m := e.turnModelFor(sessionKey); m != "" {
		if inj, ok := agent.(SessionModelInjector); ok {
			inj.SetSessionModel(m)
		}
	}
	e.applySessionInstructions(agent, ccKey)

	// Inject platform-specific formatting instructions into the agent's system prompt.
	// Clear the prompt first so instructions from a previous platform don't leak
	// into sessions for platforms that don't provide their own instructions.
	if ppi, ok := agent.(PlatformPromptInjector); ok {
		prompt := ""
		if fip, ok := p.(FormattingInstructionProvider); ok {
			prompt = fip.FormattingInstructions()
		}
		ppi.SetPlatformPrompt(prompt)
	}

	// Check if context is already canceled (e.g. during shutdown/restart)
	if e.ctx.Err() != nil {
		slog.Debug("skipping session start: context canceled", "session_key", sessionKey)
		newState := &interactiveState{platform: p, replyCtx: replyCtx, agent: agent, eventsNeedResync: true}
		adoptPendingFromPlaceholder(e.interactiveStates[sessionKey], newState)
		e.interactiveStates[sessionKey] = newState
		e.interactiveMu.Unlock()
		return newState
	}

	// Restore the agent's active provider from the session before starting a
	// new sub-process. The provider choice is persisted to disk by
	// `/provider switch`; without restoring it here, a cc-connect process
	// restart silently drops the user's choice while keeping the resumed
	// agent_session_id, producing "model X does not exist" errors when
	// the model name is sent to the wrong base_url
	// (cc-connect internal task t-20260614-qp7xnl).
	restoreActiveProviderFromSession(agent, session)

	if input == nil {
		if notice := e.freshOnColdCache(agent, session); notice != "" {
			sessions.Save()
			go e.sendFreshNotice(p, replyCtx, sessionKey, notice)
		}
		if notice := e.freshOnContextSize(agent, session, contextFreshChat(p, sessionKey)); notice != "" {
			sessions.Save()
			go e.sendFreshNotice(p, replyCtx, sessionKey, notice)
		}
		if notice := e.freshOnImageBloat(agent, session); notice != "" {
			sessions.Save()
			go e.sendFreshNotice(p, replyCtx, sessionKey, notice)
		}
	}

	// Resume only when we have a concrete saved agent session ID. If the session
	// is unbound, force a fresh start instead of attaching to whichever CLI
	// conversation happens to be "latest" in this workspace.
	startSessionID := session.GetAgentSessionID()
	// Cross-project session leakage guard (issue #599): if a session ID was
	// inherited from a different project's workspace (e.g. another
	// cc-connect project that happens to share a Session row), the agent
	// can detect the mismatch and we should clear the ID rather than
	// resume a conversation that has nothing to do with this project.
	if startSessionID != "" {
		if validator, ok := agent.(SessionIDValidator); ok && !validator.ValidateSessionID(e.ctx, startSessionID) {
			if input != nil {
				e.interactiveMu.Unlock()
				return &interactiveState{startErr: "original agent session failed validation"}
			}
			slog.Warn("session ID does not belong to this project, clearing it",
				"session_key", sessionKey, "invalid_session_id", startSessionID)
			session.SetAgentSessionID("", agent.Name())
			sessions.Save()
			startSessionID = ""
		}
	}
	isResume := startSessionID != ""
	startedFresh := !isResume // maomao fork: see MarkFreshContext below

	startDone := make(chan struct{})
	placeholder := &interactiveState{
		modelSettings:    settings,
		handoffID:        handoffID,
		agentStartDone:   startDone,
		platform:         p,
		replyCtx:         replyCtx,
		agent:            agent,
		eventsNeedResync: true,
		approveAll:       isYoloMode(agent),
	}
	adoptPendingFromPlaceholder(e.interactiveStates[sessionKey], placeholder)
	e.interactiveStates[sessionKey] = placeholder
	e.interactiveMu.Unlock()

	startAt := time.Now()
	var agentSession AgentSession
	var err error
	if input != nil {
		strict, ok := agent.(StrictResumeAgent)
		if !ok || !strict.SupportsStrictResume() {
			err = errors.New("strict resume unsupported")
		} else {
			agentSession, err = strict.StartSessionStrict(WithSessionSettings(e.ctx, settings), startSessionID)
		}
	} else {
		agentSession, err = agent.StartSession(WithSessionSettings(e.ctx, settings), startSessionID)
	}
	startElapsed := time.Since(startAt)
	if err != nil {
		// If resume/continue failed, try a fresh session as fallback.
		if startSessionID != "" && input == nil {
			slog.Error("session resume failed, falling back to fresh session",
				"session_key", sessionKey, "failed_session_id", startSessionID,
				"error", err, "elapsed", startElapsed)
			// Clear the stale session ID so CompareAndSetAgentSessionID can
			// write the new ID, matching the relay fallback at line 12640.
			session.SetAgentSessionID("", agent.Name())
			_, canHandoff := agent.(SessionHandoffReader)
			if canHandoff {
				session.SetHandoffFrom(startSessionID, "旧会话恢复失败")
			}
			sessions.Save()
			startAt = time.Now()
			agentSession, err = agent.StartSession(WithSessionSettings(e.ctx, settings), "")
			startElapsed = time.Since(startAt)
			startedFresh = true
			if err == nil {
				slog.Info("fresh session started after resume failure",
					"session_key", sessionKey, "elapsed", startElapsed)
				// maomao fork: never lose context silently.
				notice := "⚠️ 旧会话恢复失败，已改开新会话；之前的上下文靠频道记录补回"
				if canHandoff {
					notice = "⚠️ 旧会话恢复失败，已改开新会话；带上旧会话的压缩摘要和最近对话，再加频道记录补回"
				}
				go e.send(p, replyCtx, notice)
			}
		}
	}

	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()
	defer close(startDone)
	placeholder.agentStartDone = nil

	if placeholder.stopped || e.interactiveStates[sessionKey] != placeholder {
		if agentSession != nil {
			go e.closeAgentSessionWithTimeout(sessionKey, agentSession)
		}
		if placeholder.startErr == "" {
			placeholder.startErr = "session cleaned up during startup"
		}
		return placeholder
	}

	if err != nil {
		slog.Error("failed to start interactive session", "error", err, "elapsed", startElapsed)
		e.emitEvent(HookEvent{
			Event:      HookEventError,
			SessionKey: sessionKey,
			Platform:   p.Name(),
			Error:      fmt.Sprintf("failed to start session: %v", err),
		})
		newState := &interactiveState{platform: p, replyCtx: replyCtx, agent: agent, eventsNeedResync: true, startErr: err.Error()}
		adoptPendingFromPlaceholder(placeholder, newState)
		e.interactiveStates[sessionKey] = newState
		return newState
	}

	if startElapsed >= slowAgentStart {
		slog.Warn("slow agent session start", "elapsed", startElapsed, "agent", agent.Name(), "session_id", startSessionID)
	}

	if input != nil {
		_, supported := agentSession.(StrictResumeSession)
		if agentSession == nil || !supported || agentSession.CurrentSessionID() != input.expectedID {
			if agentSession != nil {
				_ = agentSession.Close()
			}
			placeholder.startErr = "strict resume returned a different or unsupported session"
			return placeholder
		}
	}

	// Surface any startup warning (e.g. permission mode downgrade under root) to the IM user.
	if warner, ok := agentSession.(StartupWarner); ok {
		if msg := warner.StartupWarning(); msg != "" {
			e.send(inputOutputPlatform(p, input), replyCtx, msg)
		}
	}

	if newID := agentSession.CurrentSessionID(); newID != "" {
		// Track the latest session ID Claude reports. Each --resume forks a new
		// session_id, so the stored ID must follow the live process or a later
		// resume (after /stop or /model) would target a stale node and lose
		// context. Session naming binds only on first assignment to avoid
		// polluting sessionNames with every forked ID.
		wasEmpty := session.GetAgentSessionID() == ""
		if session.GetAgentSessionID() != newID {
			session.SetAgentSessionID(newID, agent.Name())
			if wasEmpty {
				pendingName := session.GetName()
				if pendingName != "" && pendingName != "session" && pendingName != "default" {
					sessions.SetSessionName(newID, pendingName)
				}
			}
			sessions.Save()
		}
	}

	if startedFresh {
		// maomao fork: the new context holds none of the channel's earlier images;
		// the first turn re-attaches the recent ones (freshContextImages).
		session.MarkFreshContext()
	}
	newState := &interactiveState{
		modelSettings:    settings,
		handoffID:        handoffID,
		agentSession:     agentSession,
		processClaimed:   true,
		quotaScope:       e.quotaScopeOfSession(agent, agentSession),
		platform:         p,
		replyCtx:         replyCtx,
		agent:            agent,
		eventsNeedResync: true,
		approveAll:       isYoloMode(agent),
	}
	adoptPendingFromPlaceholder(placeholder, newState)
	e.interactiveStates[sessionKey] = newState

	slog.Info("session spawned", "session_key", sessionKey, "agent_session", session.GetAgentSessionID(), "is_resume", isResume, "elapsed", startElapsed)

	e.emitEvent(HookEvent{
		Event:      HookEventSessionStarted,
		SessionKey: sessionKey,
		Platform:   p.Name(),
		Extra: map[string]any{
			"agent_session_id": session.GetAgentSessionID(),
			"is_resume":        isResume,
		},
	})

	return newState
}

// cleanupInteractiveState removes the interactive state for the given session key
// and closes its agent session. When an expected state is provided, cleanup is
// skipped if the map entry has been replaced by a different state — this prevents
// a stale goroutine (still running after /new created a fresh Session object and
// a new turn started on it) from accidentally destroying the replacement state.
//
// IMPORTANT: The state is deleted from the map AFTER the agent session is closed
// to avoid race conditions where concurrent requests see an empty map while the
// agent session is still being shut down (which can take up to 130s for Stop hooks).
func (e *Engine) cleanupInteractiveState(sessionKey string, expected ...*interactiveState) {
	e.interactiveMu.Lock()
	if len(expected) == 0 {
		if op := e.nativeCompactions[sessionKey]; op != nil {
			op.cancel()
		}
	}
	state, ok := e.interactiveStates[sessionKey]
	if len(expected) > 0 && expected[0] != nil && state != expected[0] {
		// Another turn has already replaced the state — skip cleanup.
		e.interactiveMu.Unlock()
		return
	}
	// Capture the agent session and nil it out atomically to prevent a
	// concurrent cleanup (without expected) from closing the same session.
	var agentSession AgentSession
	if ok && state != nil {
		state.mu.Lock()
		agentSession = state.agentSession
		state.agentSession = nil
		if state.agentSessionIdleCancel != nil {
			state.agentSessionIdleCancel()
			state.agentSessionIdleCancel = nil
		}
		state.mu.Unlock()
	}
	e.interactiveMu.Unlock()

	// Notify senders of any queued messages that will never be processed.
	if ok && state != nil {
		// Stop unsolicited reader before marking stopped to avoid goroutine leak.
		e.stopUnsolicitedReader(state)

		state.markStopped()

		// Resolve any pending permission so the reader goroutine (or event
		// loop) does not block on <-pending.Resolved forever.
		state.mu.Lock()
		pending := state.pending
		state.pending = nil
		state.mu.Unlock()
		if pending != nil {
			pending.resolve()
		}

		e.notifyDroppedQueuedMessages(state, fmt.Errorf("session reset"))
	}

	// Close the agent session BEFORE deleting from the map.
	// This prevents race conditions where /stop during cleanup sees
	// an empty map and reports "No execution in progress" while
	// the agent session Close() is still blocking (up to 130s).
	if agentSession != nil {
		e.closeAgentSessionWithTimeout(sessionKey, agentSession)
	}

	// Now delete the state from the map after the session is closed.
	e.interactiveMu.Lock()
	// Re-check that the state hasn't been replaced during the close
	currentState, currentOk := e.interactiveStates[sessionKey]
	if currentOk && len(expected) > 0 && expected[0] != nil && currentState != expected[0] {
		// Another turn has replaced the state during our close — don't delete it.
		e.interactiveMu.Unlock()
		return
	}
	delete(e.interactiveStates, sessionKey)
	e.interactiveMu.Unlock()
}
