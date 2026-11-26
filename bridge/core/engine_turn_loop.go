package core

import (
	"fmt"
	"log/slog"
	"strings"
	"time"
)

type agentErrorHandler struct {
	contains string
	msgKey   MsgKey
}

var agentErrorHandlers = []agentErrorHandler{
	{"Session not found", MsgSessionNotFound},
}

func (e *Engine) processInteractiveEvents(state *interactiveState, session *Session, sessions *SessionManager, sessionKey string, msgID string, turnStart time.Time, stopTypingFn func(), sendDone <-chan error, replyCtx any, inputs ...*inputTurn) {
	turn := &interactiveTurn{state: state, session: session, sessions: sessions, sessionKey: sessionKey, msgID: msgID, turnStart: turnStart, replyCtx: replyCtx}
	// Register first so terminal accounting finishes before cleanup marks a
	// crashed process stopped (which otherwise looks like a cancelled turn).
	defer func() {
		if turn.retireExitedProcess {
			e.cleanupInteractiveState(turn.sessionKey, turn.state)
		}
	}()
	defer func() {
		outcome := "failed"
		if turn.state.isStopped() {
			outcome = "cancelled"
		}
		e.finishPublicProgress(turn.state, outcome)
	}()
	if len(inputs) > 0 {
		turn.input = inputs[0]
	}
	defer func() {
		turn.input.finish(inputTurnResult{err: fmt.Errorf("turn stopped, stream closed, or reply delivery failed before completion")})
	}()
	// A turn that ends before its EventResult (send rejected, channel closed, bridge stopping)
	// still owns a pending handback; settle it empty so the fallback posts the result.
	defer func() {
		turn.state.mu.Lock()
		jobID, wakeID, retrying := turn.state.currentJobID, turn.state.currentWakeID, turn.state.capacityFailed
		if !retrying {
			turn.state.currentJobID = ""
			turn.state.currentWakeID = ""
		}
		turn.state.mu.Unlock()
		if jobID != "" && !retrying {
			e.settleReportWake(jobID, "", nil)
		}
		if wakeID != "" && !retrying {
			settleWakeReturn(wakeID, "", errWakeNoResult)
		}
	}()
	turn.state.mu.Lock()
	ref := turn.state.authorization
	// Like startUnsolicitedReader, retain this turn's session under the lock:
	// workspace cleanup may concurrently clear the shared pointer.
	turn.agentSession = turn.state.agentSession
	turn.state.mu.Unlock()
	if turn.agentSession == nil {
		return
	}
	turn.changed, turn.unwatch, turn.watchErr = e.watchTurnAuthorization(ref)
	if turn.watchErr != nil {
		e.failAuthorizedTurn(ref)
		e.stopInteractiveSessionWithOptions(turn.sessionKey, true)
		return
	}
	defer func() { turn.unwatch() }()
	turn.outputCtx, turn.contextErr = e.turnOutputContext(ref)
	if turn.contextErr != nil {
		e.failAuthorizedTurn(ref)
		e.stopInteractiveSessionWithOptions(turn.sessionKey, true)
		return
	}
	turn.sendOutput = func(p Platform, replyCtx any, content string) {
		_ = authorizedOutput(turn.outputCtx, func() error { return e.sendWithContextForWorkspace(turn.outputCtx, p, replyCtx, content, "") })
	}

	defer func() { e.journalTurnEnd(turn.chainedJournalID) }()
	defer func() {
		// maomao fork: a lead handoff block assembled into this turn becomes
		// active only on a successful terminal result (#274). Any other exit
		// drops the taken mark so the next turn gets the complete record again.
		if !turn.keepLeadHandoffForRetry {
			turn.session.rollbackLeadHandoff()
		}
	}()
	if turn.msgID != "" {
		turn.state.mu.Lock()
		// Foreground and drained turns already initialized this message before
		// Send. Re-entering its event reader must preserve a cancel for this turn.
		turn.state.currentMessageID = turn.msgID
		turn.state.mu.Unlock()
	}

	defer func() {
		if !turn.watchTurnFinished && !turn.state.isStopped() && e.ctx.Err() == nil {
			turn.state.mu.Lock()
			p := turn.state.platform
			scheduled := turn.state.turnScheduled
			turn.state.mu.Unlock()
			// A scheduled turn's error is not the watched board item's failure (watchTurnEnded).
			e.watchTurnEnded(p, turn.sessionKey, "", turn.toolCount > 0, turn.turnFailed, scheduled, e.watchCardResult(turn.state), turn.turnStart)
		}
	}()
	turn.waitStart = time.Now()
	turn.pendingSend = sendDone

	// stopTyping tracks the current turn's typing indicator so it can be
	// stopped when a queued message starts a new turn.
	turn.stopTyping = stopTypingFn
	defer func() {
		if turn.stopTyping != nil {
			turn.stopTyping()
		}
		if turn.doneReaction != nil {
			turn.doneReaction()
		}
		e.reactTurnOutcome(turn)
	}()

	e.initTurnOutput(turn)

	// maomao fork: this turn's row on the channel task board; the card's steps
	// feed it. A turn that leaves this loop without a result was stopped.
	turn.board = e.boardBegin(turn.state, turn.sessionKey)
	turn.cp.onStep = turn.board.step
	defer func() { turn.board.finish(turn.state, BoardDoneStopped) }()

	// Send instant confirmation reply if enabled and no streaming card is active.
	// Streaming cards provide their own "processing" indicator, so instant reply
	// is only needed when the platform doesn't support cards or card creation failed.
	if e.instantReply.Enabled && turn.streamCard == nil && !turn.quietNarration {
		replyContent := e.instantReply.Content
		if replyContent == "" {
			replyContent = e.i18n.T(MsgStarting)
		}
		turn.sendOutput(inputOutputPlatform(turn.state.platform, turn.input), turn.state.replyCtx, replyContent)
	}

	// Idle timeout: resets on every received event (0 = disabled)
	if e.eventIdleTimeout > 0 {
		turn.idleTimer = time.NewTimer(e.eventIdleTimeout)
		defer turn.idleTimer.Stop()
		turn.idleCh = turn.idleTimer.C
	}

	// Max turn time: absolute wall-clock cap that does NOT reset on events.
	// Prevents long-running tool calls from blocking the session forever (#1091).
	if e.maxTurnTime > 0 {
		turnDeadlineTimer := time.NewTimer(e.maxTurnTime)
		defer turnDeadlineTimer.Stop()
		turn.turnDeadlineCh = turnDeadlineTimer.C
	}

	turn.events = turn.agentSession.Events()
	turn.stopCh = turn.state.stopSignal()

	// maomao fork: sub-agent table, and the progress card kept alive while the
	// turn waits for a foreground sub-agent (refreshed at the card's own edit
	// interval).
	e.ensureSubTaskTable(turn.state, turn.sessionKey)
	turn.subReporter, turn.hasSubReporter = turn.agentSession.(SubTaskReporter)
	retrier, _ := turn.agentSession.(APIRetryReporter)
	if turn.cp.Active() { // #2042: also for the "在等模型" line
		every := turn.cp.minUpdateInterval
		if every <= 0 { // platforms with no edit throttle of their own
			every = waitLineEvery
		}
		t := time.NewTicker(every)
		defer t.Stop()
		turn.subWaitTick = t.C
	}

	watchDone := make(chan struct{})
	defer close(watchDone)
	go e.watchStuckTurn(watchDone, &turn.handlingSince, turn.sessionKey, turn.state)
	if e.runTurnEventLoop(turn, retrier) {
		e.finishClosedTurn(turn)
	}
}

func mergeRichToolResult(steps []ToolStep, event Event, result string, maxLen int) []ToolStep {
	toolName := strings.TrimSpace(event.ToolName)
	if toolName == "" {
		toolName = "Tool"
	}

	idx := -1
	for i := len(steps) - 1; i >= 0; i-- {
		if steps[i].Kind == ToolStepKindThinking {
			continue
		}
		if strings.TrimSpace(steps[i].Name) == "" || strings.TrimSpace(steps[i].Name) == toolName {
			idx = i
			break
		}
	}
	if idx == -1 {
		summary := strings.TrimSpace(event.ToolInput)
		if summary != "" {
			summary = truncateIf(summary, maxLen)
		}
		steps = append(steps, ToolStep{
			Kind:    ToolStepKindTool,
			Name:    toolName,
			Summary: summary,
		})
		idx = len(steps) - 1
	}

	if strings.TrimSpace(steps[idx].Name) == "" {
		steps[idx].Name = toolName
	}
	if steps[idx].Kind == "" {
		steps[idx].Kind = ToolStepKindTool
	}
	if strings.TrimSpace(steps[idx].Summary) == "" && strings.TrimSpace(event.ToolInput) != "" {
		steps[idx].Summary = truncateIf(strings.TrimSpace(event.ToolInput), maxLen)
	}
	steps[idx].Result = result
	steps[idx].Status = strings.TrimSpace(event.ToolStatus)
	steps[idx].ExitCode = event.ToolExitCode
	steps[idx].Success = event.ToolSuccess
	steps[idx].Done = true
	return steps
}

// notifyDroppedQueuedMessages drains pendingMessages from the state and
// sends an error notification to each queued message's sender. Called when
// the event loop exits abnormally (EventError, channel closed) and queued
// messages can no longer be delivered to the agent.
func (e *Engine) notifyDroppedQueuedMessages(state *interactiveState, reason error) {
	if e.isStoppingForJournal() {
		// #618 K4 M2: shutdown, not a failure. The queued messages stay in the
		// journal (queued_messages of the interrupted turn) and are resumed.
		state.mu.Lock()
		n := len(state.pendingMessages)
		state.mu.Unlock()
		if n > 0 {
			slog.Info("queued messages kept for resume after shutdown", "count", n)
		}
		return
	}
	state.mu.Lock()
	if state.resetHandoff {
		// applyPendingReset hands these to the fresh session.
		state.mu.Unlock()
		return
	}
	remaining := state.pendingMessages
	state.pendingMessages = nil
	boardKey := state.boardKey
	state.mu.Unlock()
	if len(remaining) > 0 && boardKey != "" { // maomao fork: channel task board
		descs := make([]string, 0, len(remaining))
		for _, q := range remaining {
			descs = append(descs, q.boardDesc)
		}
		e.boardDropped(boardKey, descs)
	}
	for _, q := range remaining {
		ctx, err := e.turnOutputContext(q.authorization)
		if err == nil {
			text := fmt.Sprintf(e.i18n.T(MsgError), reason)
			if !e.errorKeptOutOfChat(q.platform, q.replyCtx, text) {
				_ = e.sendWithErrorContext(ctx, q.platform, q.replyCtx, text)
			}
		}
	}
}

// drainPendingMessages processes all queued messages in the state's pendingMessages
// queue. It owns the event reader while draining, restores the idle reader,
// then releases process ownership and the session after the final queue check.
// This closes both the late-enqueue window and the window in which a new
// foreground turn could race with a late background-reader/timer restart.
// Returns true if the session was unlocked by this call.
func (e *Engine) drainPendingMessages(state *interactiveState, session *Session, sessions *SessionManager, sessionKey string) bool {
	// Orphaned queues enter here without going through process acquisition.
	state.mu.Lock()
	state.processClaimed = true
	state.mu.Unlock()
	for {
		e.stopUnsolicitedReader(state)
		state.mu.Lock()
		// A time limit claimed for the turn that just ended finishes its stop
		// first: it drops the queue itself, so a message dequeued meanwhile is
		// never sent to the session it is closing (same boundary as
		// chainQueuedTurn).
		state.awaitScheduledCancelLocked()
		if e.isStoppingForJournal() {
			// #1368: do not dequeue, reset-handoff or rewrite the interrupted
			// turn after Stop has begun; the journal already holds its queue.
			if n := len(state.pendingMessages); n > 0 {
				slog.Info("queued messages kept for resume after shutdown", "count", n)
			}
			state.processClaimed = false
			session.Unlock()
			state.mu.Unlock()
			return true
		}
		if state.stopped && state.resetHandoff {
			// A gate abort had to close the process. This worker still owns the
			// conversation lock: move unsent messages to the replacement state
			// and hand that lock to its drain, without replaying the cancelled task.
			closed := state.abortCloseDone
			state.mu.Unlock()
			if closed != nil {
				select {
				case <-closed:
				case <-e.ctx.Done():
					session.Unlock()
					return true
				}
			}
			state.mu.Lock()
			held := state.pendingMessages
			state.pendingMessages = nil
			agent, workspaceDir := state.agent, state.workspaceDir
			state.mu.Unlock()
			if len(held) > 0 {
				e.handOffQueuedAfterReset(sessions, held[0].msgSessionKey, sessionKey, held, agent, workspaceDir)
			}
			e.drainOrphanedQueue(session, sessions, sessionKey, agent, workspaceDir)
			return true
		}
		droppedStale := 0
		var staleDescs []string // maomao fork: channel task board
		e.refreshQueuedTaskReviewsLocked(state)
		for len(state.pendingMessages) > 0 && e.isQueuedUserMessageStaleForDrainLocked(state, state.pendingMessages[0].userMessageTimeMs) {
			staleDescs = append(staleDescs, state.pendingMessages[0].boardDesc)
			state.pendingMessages = state.pendingMessages[1:]
			droppedStale++
		}
		if droppedStale > 0 {
			e.boardDropped(sessionKey, staleDescs)
			slog.Info("dropped stale queued user messages while draining",
				"session", sessionKey,
				"dropped", droppedStale,
			)
		}
		if len(state.pendingMessages) == 0 {
			alive := state.agentSession != nil && state.agentSession.Alive() && !state.stopped && !state.eventsNeedResync
			closeAfterFailure := !state.stopped && agentSessionResumable(state.agent, state.agentSession)
			workspaceDir := state.workspaceDir
			state.mu.Unlock()
			if alive {
				e.startUnsolicitedReader(state, session, sessions, sessionKey, workspaceDir)
			}
			// Cancel before the final queue check: cancellation may itself let a
			// pending enqueue finish. Closing is armed only after ownership ends.
			e.cancelAgentSessionIdleClose(state)
			state.mu.Lock()
			if len(state.pendingMessages) != 0 {
				// A message arrived while restoring idle state. Keep ownership
				// and stop that reader again before sending the queued prompt.
				state.mu.Unlock()
				e.cancelAgentSessionIdleClose(state)
				continue
			}
			state.processClaimed = false
			session.Unlock()
			state.mu.Unlock()
			if alive || closeAfterFailure {
				e.scheduleAgentSessionIdleClose(sessionKey, state)
			}
			return true
		}
		queued := takeQueuedBatchLocked(state) // a burst from one sender runs as one turn
		state.authorization = queued.authorization
		state.platform = queued.platform
		state.replyCtx = queued.replyCtx
		state.injectedReplyCtxs = nil
		state.currentMessageID = queued.messageID
		state.fromVoice = queued.fromVoice
		state.currentTurnUserMessageTimeMs = queued.userMessageTimeMs
		state.turnUserID = queued.userID
		state.markTurnStartLocked()
		state.turnDesc = queued.boardDesc // maomao fork: channel task board
		state.turnScheduled = scheduledTurnUser(queued.userID)
		state.mu.Unlock()

		e.i18n.DetectAndSet(queued.content)
		rawQueued := queued // maomao fork: re-delivered as-is after a capacity cooldown
		if wait := e.capacityWait(state.quotaScope); wait > 0 {
			// Before withTurnBlocks: an unsent message must not mark anything sent.
			e.deferForCapacity(queued.platform, queuedToMessage(rawQueued), state.agent, sessions, sessionKey, state.workspaceDir, wait, true)
			continue
		}
		e.startScheduledQueuedTurn(&queued, session)
		rawQueued = queued // maomao fork: re-delivered with its backfill (those posts are marked seen now)
		queued.content = session.renderReference(queued.content, queued.reference)
		state.mu.Lock()
		queuedAgent, queuedWorkspace := state.agent, state.workspaceDir
		state.mu.Unlock()
		prompt := queued.content // #2041: a native command is the whole prompt, as typed
		if !queued.nativeCommand {
			queued.content = e.withTurnBlocksRef(session, queued.msgSessionKey, queued.turnCtxQuery, queued.turnCtxSender, queued.content, queued.turnCtx, queued.reference)
			prompt = e.buildSenderPrompt(withVoiceNote(queued.content, queued.fromVoice && !queued.voiceMarked), queued.userID, queued.userName, queued.msgPlatform, queued.msgSessionKey, queued.channelKey)
			prompt = e.withSharedMemoryHint(prompt, queuedAgent, &Message{SessionKey: queued.msgSessionKey, ChannelKey: queued.channelKey}, queuedWorkspace)
			prompt = e.withChannelAgentInstructions(prompt, queued.userID, queued.fromBot, queued.platform, queued.msgSessionKey, session, queuedAgent)
		}

		state.mu.Lock()
		as := state.agentSession // capture under lock to avoid race with cleanup (mirrors #1436)
		state.mu.Unlock()
		if as == nil || !as.Alive() {
			session.SettleHandoff(false)
			session.rollbackLeadHandoff()
			e.send(queued.platform, queued.replyCtx, fmt.Sprintf(e.i18n.T(MsgError), "agent session ended"))
			e.notifyDroppedQueuedMessages(state, fmt.Errorf("agent session ended"))
			return false
		}

		drainEvents(as.Events())

		session.AddHistory("user", queued.content)
		// #618 K1: chained into a running turn -> update its entry; a drain with
		// no outer turn (orphaned queue, after /compress) owns one per message.
		journalID, journalOwned := e.journalQueuedTurn(&rawQueued, sessionKey, queuedWorkspace, as) // raw text, before the turn blocks
		e.journalSyncQueued(state, sessionKey)                                                      // #618 K4 #12: dequeued
		e.armResumeRetry(state, session, rawQueued.resumeFallback)                                  // #618 K4 S1

		var stopTyping func()
		if ti, ok := queued.platform.(TypingIndicator); ok {
			stopTyping = e.startAuthorizedTyping(ti, queued.replyCtx, queued.authorization)
		}

		slog.Info("processing queued message", "session", sessionKey)
		e.setTurnMode(state, as, queued.modeOverride) // restored when runTurnWithCapacityRetry returns
		state.mu.Lock()
		state.currentJobID = queued.timerJobID
		state.currentWakeID = queued.wakeID
		state.mu.Unlock()
		e.armScheduledTurnTimeout(state, sessionKey, queued.turnTrigger, queued.timerJobID, queued.cronJobID, queued.userID, true)
		e.armTurnSpendCap(state, session, sessionKey, queued.turnTrigger, queued.timerJobID, queued.cronJobID, queued.msgSessionKey)
		var attemptPrompt string
		usageMessage := queuedToMessage(queued)
		e.runTurnWithCapacityRetry(state, session, sessions, sessionKey, queued.messageID, time.Now(), stopTyping, queued.replyCtx, nil, &usageMessage,
			func() { // per attempt, like the direct turn: a capacity retry needs a live run
				state.mu.Lock()
				state.currentJobID = queued.timerJobID // re-armed for a capacity retry
				state.currentWakeID = queued.wakeID
				state.mu.Unlock()
				e.noteCallerTurn(queued.msgSessionKey, queued.msgPlatform, queued.userID, queued.userName, queued.channelKey, queued.fromBot, queued.timerJobID != "" || queued.cronJobID != "", false)
				attemptPrompt = prompt
				if !queued.nativeCommand {
					attemptPrompt = e.withPublicProgress(prompt, state, queued.msgSessionKey, queued.fromBot, queued.fromVoice)
				}
			},
			func(as AgentSession) error {
				if as == nil {
					session.SettleHandoff(false)
					return fmt.Errorf("agent session became nil")
				}
				err := e.recordTurnAgent(queued.authorization, queuedAgent)
				if err == nil {
					err = as.Send(attemptPrompt, queued.messageID, sniffImageMimes(queued.images), queued.files)
				}
				session.SettleHandoff(err == nil) // maomao fork: put an undelivered handoff back
				if err != nil && (state.isStopped() || !as.Alive()) {
					// #2132: already off the queue when the session went away — it
					// ends like the dropped queued messages, not as a turn error
					// on a dead process.
					err = fmt.Errorf("agent session ended")
				}
				return err
			},
			false, // a message drained from the queue was already offered its probe
			func(wait time.Duration) {
				e.deferForCapacity(queued.platform, queuedToMessage(rawQueued), state.agent, sessions, sessionKey, state.workspaceDir, wait, false)
			})
		if journalOwned {
			e.journalTurnEnd(journalID)
		}
		// maomao fork: the provider refused the prompt as too long; re-run on a fresh session.
		if errMsg, q := state.takePromptTooLong(); errMsg != "" {
			if q != nil {
				rawQueued = *q
			}
			if e.retryFreshOnPromptTooLong(rawQueued.platform, queuedToMessage(rawQueued), errMsg, state, session, sessions, state.agent, sessionKey, state.workspaceDir, rawQueued.msgSessionKey) {
				return true
			}
		}
		// #618 K4 S1: a queued resume whose resumed session failed at once.
		if errMsg, q := state.takeResumeFailed(); errMsg != "" {
			if q != nil {
				rawQueued = *q
			}
			if e.retryFreshOnResumeError(rawQueued.platform, queuedToMessage(rawQueued), errMsg, state, session, sessions, state.agent, sessionKey, state.workspaceDir, rawQueued.msgSessionKey) {
				return true
			}
		}
		// #1414: a queued turn the upstream classifier refused.
		if errMsg, q := state.takeRefused(); errMsg != "" {
			if q != nil {
				rawQueued = *q
			}
			if e.retryFreshOnRefusal(rawQueued.platform, queuedToMessage(rawQueued), errMsg, state, session, sessions, state.agent, sessionKey, state.workspaceDir, rawQueued.msgSessionKey) {
				return true
			}
		}
		// #1562: a queued workspace turn on a cheap lane that ended with an API error.
		if errMsg, q := state.takeCheapFailed(); errMsg != "" {
			if q != nil {
				rawQueued = *q
			}
			if e.retryOnLeadAfterCheapFailure(rawQueued.platform, queuedToMessage(rawQueued), errMsg, state, session, sessions, state.agent, sessionKey, state.workspaceDir, rawQueued.msgSessionKey) {
				return true
			}
		}
	}
}
