package core

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"
)

// initTurnOutput sets up where and how this turn's output reaches the
// platform: the send helpers, the streaming card, the preview and the
// progress card.
func (e *Engine) initTurnOutput(turn *interactiveTurn) {
	turn.state.mu.Lock()
	turn.workspaceDir = turn.state.workspaceDir
	turn.replyAgent = turn.state.agent
	if turn.replyAgent == nil {
		turn.replyAgent = e.agent
	}
	workspaceRenderer := func(content string) string {
		return e.renderOutgoingContentForWorkspace(turn.state.platform, content, turn.workspaceDir)
	}
	// sendWorkspace* deliver the agent's own output (text, thinking, tool
	// lines); maomao fork: the reply context is marked so backfill skips them.
	turn.sendWorkspace = func(p Platform, replyCtx any, content string) {
		err := authorizedOutput(turn.outputCtx, func() error {
			return e.sendWithContextForWorkspace(turn.outputCtx, p, markAgentReply(p, replyCtx, turn.session), content, turn.workspaceDir)
		})
		if err == nil && turn.session.Side {
			e.recordExternalSend(p, turn.sessionKey, turn.workspaceDir, content, "定时侧会话")
		}
	}
	turn.sendWorkspaceWithError = func(p Platform, replyCtx any, content string) error {
		err := authorizedOutput(turn.outputCtx, func() error {
			return e.sendWithContextForWorkspace(turn.outputCtx, p, markAgentReply(p, replyCtx, turn.session), content, turn.workspaceDir)
		})
		if err != nil {
			turn.input.finish(inputTurnResult{err: fmt.Errorf("reply delivery: %w", err)})
		} else if turn.session.Side {
			e.recordExternalSend(p, turn.sessionKey, turn.workspaceDir, content, "定时侧会话")
		}
		return err
	}

	turn.sendReplySegment = func(p Platform, replyCtx any, segment string) {
		// A scheduled turn's narration between tool calls is the agent thinking
		// aloud; only its final reply is meant for the chat (#953).
		if turn.quietNarration {
			return
		}
		// A live streaming card already shows every word of this turn; a
		// segment sent beside it repeats the same text as a second message
		// (#703: DingTalk AI card, thinking/tool/permission flushes).
		if turn.streamCard != nil && !turn.streamCard.Failed() {
			return
		}
		if capability, ok := p.(RepeatedReplySuppressor); !ok || !capability.SuppressRepeatedReplyText() {
			for _, chunk := range SplitMessageCodeFenceAware(segment, maxPlatformMessageLen) {
				turn.sendWorkspace(p, replyCtx, chunk)
			}
			return
		}
		segment = unsentReplyText(p, segment, turn.sentReplySegments)
		// A narration segment that is only a receipt note to the agent itself
		// is not chat content either; drop it at the same boundary.
		if isMetaOnlyReply(segment) {
			return
		}
		if strings.TrimSpace(segment) == "" {
			return
		}
		chunks := SplitMessageCodeFenceAware(segment, maxPlatformMessageLen)
		for i, chunk := range chunks {
			if err := turn.sendWorkspaceWithError(p, replyCtx, chunk); err != nil {
				// Record chunks already on the platform so a later repeat of
				// them is still suppressed; the failed tail stays retryable.
				turn.sentReplySegments = append(turn.sentReplySegments, chunks[:i]...)
				return
			}
		}
		turn.sentReplySegments = append(turn.sentReplySegments, segment)
	}

	turn.quietNarration = turn.state.turnScheduled && !e.isTeamWorkspaceChat(turn.sessionKey)
	// Streaming card: aggregate entire turn into a single updatable card. A
	// quiet scheduled turn opens none — the card is a live preview surface
	// and its interim text would stream into the chat (#953).
	if scp, ok := inputOutputPlatform(turn.state.platform, turn.input).(StreamingCardPlatform); ok && !turn.quietNarration {
		if sc, err := authorizedOutputValue(turn.outputCtx, func() (StreamingCard, error) { return scp.CreateStreamingCard(turn.outputCtx, turn.state.replyCtx) }); err != nil {
			slog.Warn("streaming card creation failed, falling back to normal messages", "error", err)
		} else {
			turn.streamCard = sc
			slog.Info("streaming card created for turn", "session", turn.sessionKey)
		}
	}
	// maomao fork: previews and the progress card carry agent output (AgentReplyMarker).
	turn.sp = newStreamPreview(e.turnPreviewCfg(turn.quietNarration), inputOutputPlatform(turn.state.platform, turn.input), markAgentReply(turn.state.platform, turn.state.replyCtx, turn.session), turn.outputCtx, workspaceRenderer)
	// A failed freeze has not delivered the segment. Stop this output turn
	// before detaching its preview or recording the segment as sent.
	turn.freezePreview = func() bool {
		if err := turn.sp.freeze(); err != nil {
			slog.Error("stream preview: committing segment failed", "session", turn.sessionKey, "error", err)
			turn.state.mu.Lock()
			turn.state.eventsNeedResync = true
			turn.state.mu.Unlock()
			turn.input.finish(inputTurnResult{err: fmt.Errorf("preview segment delivery: %w", err)})
			return false
		}
		return true
	}
	turn.cp = newCompactProgressWriter(turn.outputCtx, inputOutputPlatform(turn.state.platform, turn.input), markAgentReply(turn.state.platform, turn.state.replyCtx, turn.session), e.agent.Name(), e.i18n.CurrentLang(), workspaceRenderer)
	turn.cp.mirrorFor = e.taskThreadProgressContext(turn.outputCtx, inputOutputPlatform(turn.state.platform, turn.input), turn.sessionKey, workspaceRenderer)
	if turn.quietNarration {
		turn.cp.hideForScheduled()
	}
	turn.state.mu.Unlock()
}

// runTurnEventLoop reads the turn's agent events until the turn ends. It
// returns true when the agent event channel closed (the process exited).
func (e *Engine) runTurnEventLoop(turn *interactiveTurn, retrier APIRetryReporter) bool {
	for {
		event, flow := e.awaitTurnEvent(turn, retrier)
		switch flow {
		case turnFlowContinue:
			continue
		case turnFlowReturn:
			return false
		case turnFlowClosed:
			return true
		}
		if e.handleTurnEvent(turn, event) == turnFlowReturn {
			return false
		}
	}
}

// awaitTurnEvent waits for the next agent event of the turn. Timers, the
// prompt send result, stop and authorization changes are handled here; only
// an event to handle comes back with turnFlowNext.
func (e *Engine) awaitTurnEvent(turn *interactiveTurn, retrier APIRetryReporter) (Event, turnFlow) {
	var event Event
	var ok bool

	turn.handlingSince.Store(0)
	select {
	case <-turn.stopCh:
		turn.sp.discard()
		return event, turnFlowReturn
	case event, ok = <-turn.events:
		if !ok {
			return event, turnFlowClosed
		}
		turn.state.lastEventAt.Store(time.Now().UnixNano())
		turn.lastEvtType, turn.lastEvtAt = event.Type, time.Now()
	case <-turn.subWaitTick:
		var sub SubTask
		fg := false
		if turn.hasSubReporter {
			sub, fg = foregroundSubTask(turn.subReporter)
		}
		if fg {
			turn.cp.ShowSubAgentWait(subAgentWaitText(e.i18n.IsZhLike(), sub))
		} else if w := turn.modelWait(e.i18n.IsZhLike(), retrier); w != "" {
			turn.cp.ShowSubAgentWait(w)
		} else {
			turn.cp.ClearSubAgentWait()
		}
		return event, turnFlowContinue
	case err := <-turn.pendingSend:
		turn.pendingSend = nil
		if err != nil {
			turn.input.finish(inputTurnResult{err: err})
			slog.Error("failed to send prompt", "error", err, "session_key", turn.sessionKey)
			turn.promptSendFailed = true
			turn.sp.discard()
			if turn.stopTyping != nil {
				turn.stopTyping()
				turn.stopTyping = nil
			}
			e.notifyDroppedQueuedMessages(turn.state, err)
			if turn.agentSession == nil || !turn.agentSession.Alive() {
				e.cleanupInteractiveState(turn.sessionKey, turn.state)
			}
			turn.state.mu.Lock()
			p := inputOutputPlatform(turn.state.platform, turn.input)
			turn.state.mu.Unlock()
			turn.sendOutput(p, turn.replyCtx, fmt.Sprintf(e.i18n.T(MsgError), err))
			return event, turnFlowReturn
		}
		return event, turnFlowContinue
	case <-turn.idleCh:
		turn.input.finish(inputTurnResult{err: fmt.Errorf("agent session idle timeout")})
		slog.Error("agent session idle timeout: no events for too long, killing session",
			"session_key", turn.sessionKey, "timeout", e.eventIdleTimeout, "elapsed", time.Since(turn.turnStart))
		turn.cp.Finalize(ProgressCardStateFailed)
		turn.board.finish(turn.state, BoardDoneFailed)
		turn.sp.discard()
		turn.state.mu.Lock()
		turn.state.eventsNeedResync = true
		p := inputOutputPlatform(turn.state.platform, turn.input)
		turn.state.mu.Unlock()
		turn.sendOutput(p, turn.replyCtx, fmt.Sprintf(e.i18n.T(MsgError), "agent session timed out (no response)"))
		e.cleanupInteractiveState(turn.sessionKey, turn.state)
		return event, turnFlowReturn
	case <-turn.turnDeadlineCh:
		turn.input.finish(inputTurnResult{err: fmt.Errorf("agent turn exceeded maximum time")})
		elapsed := time.Since(turn.turnStart)
		slog.Warn("agent turn exceeded max_turn_time: sending stop signal, will force-kill if needed",
			"session_key", turn.sessionKey, "max_turn_time", e.maxTurnTime, "elapsed", elapsed)
		turn.cp.Finalize(ProgressCardStateFailed)
		turn.board.finish(turn.state, BoardDoneFailed)
		turn.sp.discard()
		turn.state.mu.Lock()
		p := inputOutputPlatform(turn.state.platform, turn.input)
		turn.state.mu.Unlock()
		turn.sendOutput(p, turn.replyCtx, fmt.Sprintf(e.i18n.T(MsgError),
			fmt.Sprintf("agent turn exceeded maximum time (%v), stopping", e.maxTurnTime)))

		// Two-phase shutdown: first try a graceful stop so the agent can
		// write its final state before dying (preserves --resume ability).
		// If it doesn't exit within a short grace window, force-kill.
		turn.state.markStopped()
		gracePeriod := 10 * time.Second
		graceTimer := time.NewTimer(gracePeriod)
	graceLoop:
		for {
			select {
			case evt, ok := <-turn.agentSession.Events():
				if !ok || (ok && evt.Done) {
					// Agent exited cleanly; state is intact, resume will work.
					slog.Info("agent exited gracefully after max_turn_time stop signal",
						"session_key", turn.sessionKey, "elapsed", time.Since(turn.turnStart))
					graceTimer.Stop()
					turn.state.mu.Lock()
					turn.state.eventsNeedResync = false
					turn.state.mu.Unlock()
					break graceLoop
				}
			case <-graceTimer.C:
				// Agent did not stop within grace period — force-kill.
				slog.Error("agent did not stop within grace period after max_turn_time; force-killing",
					"session_key", turn.sessionKey, "grace_period", gracePeriod)
				graceTimer.Stop()
				turn.state.mu.Lock()
				turn.state.eventsNeedResync = true
				turn.state.mu.Unlock()
				e.cleanupInteractiveState(turn.sessionKey, turn.state)
				return event, turnFlowReturn
			}
		}
		// Graceful exit path: cleanupInteractiveState closes the session,
		// but eventsNeedResync=false so the next --resume works correctly.
		e.cleanupInteractiveState(turn.sessionKey, turn.state)
		return event, turnFlowReturn
	case <-turn.changed:
		turn.sp.discard()
		e.stopInteractiveSessionWithOptions(turn.sessionKey, true)
		return event, turnFlowReturn
	case <-e.ctx.Done():
		turn.state.mu.Lock()
		turn.state.eventsNeedResync = true
		turn.state.mu.Unlock()
		return event, turnFlowReturn
	}

	turn.handlingSince.Store(time.Now().UnixNano())
	if turn.state.isStopped() {
		turn.sp.discard()
		turn.state.mu.Lock()
		turn.state.eventsNeedResync = true
		turn.state.mu.Unlock()
		return event, turnFlowReturn
	}

	// Reset idle timer after receiving an event
	if turn.idleTimer != nil {
		if !turn.idleTimer.Stop() {
			select {
			case <-turn.idleTimer.C:
			default:
			}
		}
		turn.idleTimer.Reset(e.eventIdleTimeout)
	}

	if !turn.firstEventLogged {
		turn.firstEventLogged = true
		if elapsed := time.Since(turn.waitStart); elapsed >= slowAgentFirstEvent {
			slog.Warn("slow agent first event", "elapsed", elapsed, "session", turn.sessionKey, "event_type", event.Type)
		}
	}
	return event, turnFlowNext
}

// handleTurnEvent handles one agent event of the turn: the checks every
// event goes through, then the handler for its type.
func (e *Engine) handleTurnEvent(turn *interactiveTurn, event Event) turnFlow {
	turn.state.mu.Lock()
	p := inputOutputPlatform(turn.state.platform, turn.input)
	turn.state.mu.Unlock()

	rv := e.richCardViewFor(turn, p)

	if turn.input != nil && event.SessionID != "" && event.SessionID != turn.input.expectedID {
		turn.input.finish(inputTurnResult{err: fmt.Errorf("event belongs to a different agent session")})
		turn.state.mu.Lock()
		turn.state.eventsNeedResync = true
		turn.state.mu.Unlock()
		return turnFlowReturn
	}

	if event.Type == EventResult && event.Done && len(event.Images) > 0 {
		var imageErr error
		if turn.input != nil {
			imageErr = fmt.Errorf("image-only output is not supported by the text input response")
		} else if !e.attachmentSendEnabled {
			imageErr = ErrAttachmentSendDisabled
		} else if sender, ok := p.(ImageSender); !ok {
			imageErr = fmt.Errorf("platform %s: %w", p.Name(), ErrNotSupported)
		} else {
			for _, img := range event.Images {
				turn.mediaAttempted = true
				imageErr = authorizedOutput(turn.outputCtx, func() error {
					if err := e.waitOutgoing(p); err != nil {
						return err
					}
					return sender.SendImage(turn.outputCtx, turn.replyCtx, img)
				})
				if imageErr != nil {
					break
				}
				turn.state.mu.Lock()
				turn.state.turnSentNonText = true
				turn.state.mu.Unlock()
			}
			if imageErr == nil {
				e.noteWorkspaceImages(turn.sessionKey, event.Images)
			}
		}
		if imageErr != nil {
			event = Event{Type: EventError, SessionID: event.SessionID, Error: fmt.Errorf("deliver agent image: %w", imageErr)}
		}
	}
	if turn.input == nil && event.Type == EventError && errors.Is(event.Error, ErrNoPublicAnswer) && event.Content == "" {
		turn.state.mu.Lock()
		deliveredMedia := turn.state.turnSentNonText
		turn.state.mu.Unlock()
		if deliveredMedia {
			// The adapter cannot see successful /send deliveries. The engine
			// can: a delivered image/file is already a public answer.
			event = Event{Type: EventResult, SessionID: event.SessionID, Done: true}
		}
	}

	e.observeQuotaEventFor(event, turn.sessionKey, turn.agentSession, turn.state.quotaScope)
	e.observeRoleAgentEvent(turn.sessionKey, event, turn.textParts)

	// maomao fork: the agent compacted its context, so the per-turn blocks are gone.
	if c, _ := event.Metadata[MetaContextCompacted].(bool); c {
		turn.session.ResetTurnCtx()
	}

	// #1536: the agent is stuck in its own model retry; say so once per turn, on the card when
	// there is one, else as a short message, so a new user does not think the install broke.
	if why, ok := event.Metadata[MetaModelRetry].(string); ok {
		if !turn.modelRetryShown {
			turn.modelRetryShown = true
			note := modelRetryNotice(e.i18n.IsZhLike(), why)
			if !turn.cp.AppendStructured(ProgressCardEntry{Kind: ProgressEntryInfo, Text: note}, note) {
				turn.state.mu.Lock()
				rc := turn.state.replyCtx
				turn.state.mu.Unlock()
				e.send(p, rc, note)
			}
		}
		return turnFlowContinue
	}

	// A boundary ends the current segment even when quiet mode joins the
	// surrounding prose. Remove its control marker before the next text.
	if (event.Type == EventToolUse || event.Type == EventThinking || event.Type == EventPermissionRequest) && len(turn.textParts) > turn.segmentStart {
		segment := joinReplyParts(turn.textParts[turn.segmentStart:])
		if clean := stripSilentReply(segment); clean != segment {
			turn.textParts = append(turn.textParts[:turn.segmentStart], clean)
		}
	}

	// A Stop hook blocked the reply now in the open segment and asked for a
	// rewrite: take the draft back so the user does not get both (11-08 DM).
	if len(turn.textParts) > turn.segmentStart {
		if draft, ok := turn.state.takeStopDraft(strings.Join(turn.textParts[turn.segmentStart:], "")); ok {
			turn.sp.retract()
			slog.Info("stop hook: withdrew the blocked draft from the channel", "session", turn.sessionKey, "draft_runes", utf8.RuneCountInString(draft))
			turn.textParts = turn.textParts[:turn.segmentStart]
			turn.silentHold = false
			if len(draft) > len(turn.blockedDraft) {
				turn.blockedDraft = draft
			}
		}
	}

	switch event.Type {
	case EventSpeechText:
		return e.onTurnSpeechText(turn, p, rv, event)
	case EventThinking:
		return e.onTurnThinking(turn, p, rv, event)
	case EventToolUse:
		return e.onTurnToolUse(turn, p, rv, event)
	case EventToolResult:
		return e.onTurnToolResult(turn, p, rv, event)
	case EventText:
		return e.onTurnText(turn, p, rv, event)
	case EventPermissionRequest:
		return e.onTurnPermissionRequest(turn, p, rv, event)
	case EventResult:
		return e.onTurnResult(turn, p, rv, event)
	case EventError:
		return e.onTurnError(turn, p, rv, event)
	}
	return turnFlowNext
}

// richCardView is what the event loop knows about the platform's rich card
// for one event: the builder, whether rich cards are on for this turn, and
// the platform's markdown resolver.
type richCardView struct {
	supporter   RichCardSupporter
	has         bool
	resolver    RichCardMarkdownResolver
	hasResolver bool
	ctx         context.Context
}

// main codebase has no per-session quiet flag; pr309 referenced
// sessionQuiet which we drop. e.display.ThinkingMessages /
// ToolMessages handle user-level quiet in the fallback branches.
func (e *Engine) richCardViewFor(turn *interactiveTurn, p Platform) richCardView {
	v := richCardView{ctx: e.ctx}
	v.supporter, v.has = p.(RichCardSupporter)
	// Card 2.0 rich-card path is opt-in via [display] mode = "rich".
	// Default "legacy" keeps upstream behavior for all platforms.
	// A quiet scheduled turn streams no interim card either (#953).
	if e.display.CardMode != "rich" || turn.quietNarration {
		v.has = false
	}
	v.resolver, v.hasResolver = p.(RichCardMarkdownResolver)
	return v
}

func (v richCardView) resolve(markdown string, final bool) string {
	if !v.hasResolver || markdown == "" {
		return markdown
	}
	return v.resolver.ResolveRichCardMarkdown(v.ctx, markdown, final)
}

func (v richCardView) build(status CardStatus, title string, steps []ToolStep, markdown string, streaming bool, statusFooter string) string {
	return v.supporter.BuildRichCard(status, title, steps, v.resolve(markdown, !streaming), streaming, statusFooter)
}

// onTurnSpeechText hands speech-only text to a voice input turn.
func (e *Engine) onTurnSpeechText(turn *interactiveTurn, p Platform, rv richCardView, event Event) turnFlow {
	// Never present these again in platform text/history: the ordinary
	// EventText/Result stream owns those. Require concrete source ID.
	if turn.input != nil && turn.input.appendSpeech != nil && event.SessionID == turn.input.expectedID {
		if turn.agentSession.CurrentSessionID() != turn.input.expectedID {
			turn.input.finish(inputTurnResult{err: fmt.Errorf("speech source binding changed")})
			return turnFlowReturn
		}
		turn.input.appendSpeech(event.Content)
	}
	return turnFlowNext
}

// onTurnThinking shows one thinking event: on the rich card, the streaming
// card, the progress card or as a standalone message.
func (e *Engine) onTurnThinking(turn *interactiveTurn, p Platform, rv richCardView, event Event) turnFlow {
	if isEllipsisOnly(event.Content) {
		return turnFlowContinue
	}
	if rv.has {
		// When thinking messages are suppressed, skip card creation.
		if !e.display.ThinkingMessages {
			return turnFlowContinue
		}
		if thinking := strings.TrimSpace(truncateIf(event.Content, e.display.ThinkingMaxLen)); thinking != "" {
			turn.toolSteps = append(turn.toolSteps, ToolStep{
				Kind:    ToolStepKindThinking,
				Name:    "Thinking",
				Summary: thinking,
				Done:    true,
			})
		}
		e.showRichStepCard(turn, p, rv, CardStatusThinking, "initial thinking card", "thinking card")
		return turnFlowContinue
	}
	// When thinking messages are hidden, behavior depends on display mode:
	//   quiet / progress_style=card: keep text in the open segment so a
	//     hidden thinking boundary never splits narration into chat
	//   compact: freeze+detach to split text into separate cards
	if !e.display.ThinkingMessages && len(turn.textParts) > turn.segmentStart && (turn.streamCard == nil || turn.streamCard.Failed()) {
		if e.display.Mode == "quiet" || turn.cp.style == progressStyleCard {
			if turn.sp.canPreview() && turn.sp.appendSeparator("\n\n") {
				turn.textParts = append(turn.textParts, "\n\n")
			}
		} else {
			if turn.sp.canPreview() {
				if !turn.freezePreview() {
					return turnFlowReturn
				}
				turn.sp.detachPreview()
			} else {
				segment := stripSilentReply(joinReplyParts(turn.textParts[turn.segmentStart:]))
				if segment != "" {
					turn.sendReplySegment(p, turn.replyCtx, segment)
				}
			}
			turn.segmentStart = len(turn.textParts)
		}
		turn.silentHold = false
	}
	if e.display.ThinkingMessages && event.Content != "" {
		// --- StreamingCard path ---
		if turn.streamCard != nil && !turn.streamCard.Failed() {
			turn.cardThinkingText = truncateIf(event.Content, e.display.ThinkingMaxLen)
			_ = authorizedOutput(turn.outputCtx, func() error {
				return turn.streamCard.Update(turn.outputCtx, turn.streamCardContent())
			})
			return turnFlowContinue // skip original independent message sending
		}
		// --- Original path (fallback) ---
		// maomao fork: with progress_style=card, narration before a
		// thinking step goes into the progress card and never into
		// standalone chat messages, even after a card transport failure.
		if turn.cp.style == progressStyleCard && len(turn.textParts) > turn.segmentStart {
			turn.sp.discard()
			if segment := strings.TrimSpace(stripSilentReply(joinReplyParts(turn.textParts[turn.segmentStart:]))); segment != "" && turn.cp.Active() {
				turn.cp.Append(segment)
			}
			turn.segmentStart = len(turn.textParts)
			turn.silentHold = false
		}
		// Flush accumulated text segment before thinking display
		previewActive := turn.sp.canPreview()
		if len(turn.textParts) > turn.segmentStart {
			if !previewActive {
				segment := stripSilentReply(joinReplyParts(turn.textParts[turn.segmentStart:]))
				if segment != "" {
					turn.sendReplySegment(p, turn.replyCtx, segment)
				}
			}
		}
		if !turn.freezePreview() {
			return turnFlowReturn
		}
		turn.segmentStart = len(turn.textParts)
		turn.silentHold = false
		if previewActive {
			turn.sp.detachPreview() // keep frozen preview visible as permanent message
		}
		preview := truncateIf(event.Content, e.display.ThinkingMaxLen)
		thinkingMsg := fmt.Sprintf(e.i18n.T(MsgThinking), preview)
		// maomao fork: the card keeps the whole thought; only the 简略 view and
		// the standalone message are shortened (#1197).
		cardThinking := preview
		if turn.cp.style == progressStyleCard {
			cardThinking = event.Content
		}
		if !turn.cp.AppendEvent(ProgressEntryThinking, cardThinking, "", thinkingMsg) {
			turn.sendWorkspace(p, turn.replyCtx, thinkingMsg)
		}
	}
	return turnFlowNext
}

// onTurnToolUse shows one tool call and commits the text segment before it.
func (e *Engine) onTurnToolUse(turn *interactiveTurn, p Platform, rv richCardView, event Event) turnFlow {
	turn.toolCount++
	turn.toolStartAt = time.Now()
	e.teamNoteWork(turn.sessionKey)
	turn.state.mu.Lock()
	turn.state.resumeArmed = false // #618 K4 S1: the resumed session works
	turn.state.mu.Unlock()
	e.journalProgress(turn.sessionKey, strings.TrimSpace(event.ToolName+" "+event.ToolInput), "", true) // #618 K4
	e.emitStreamEvent(StreamEventTool, turn.sessionKey, event.ToolInput, map[string]any{"tool": event.ToolName})
	e.notePublicProgressTool(turn.state, event.ToolInput)
	// maomao fork: with progress_style=card (or an active compact
	// progress writer when tool messages are shown), narration between
	// tool calls ("Now my own file.") goes into the progress card and
	// never into standalone chat messages — even when tool_messages is
	// false or after a transient card transport failure.
	if !rv.has && len(turn.textParts) > turn.segmentStart && (turn.streamCard == nil || turn.streamCard.Failed()) &&
		(turn.cp.style == progressStyleCard || (e.display.ToolMessages && turn.cp.Active())) {
		turn.sp.discard()
		if segment := strings.TrimSpace(stripSilentReply(joinReplyParts(turn.textParts[turn.segmentStart:]))); segment != "" && turn.cp.Active() {
			turn.cp.Append(segment)
		}
		turn.segmentStart = len(turn.textParts)
		turn.silentHold = false
	}
	// Tool detail visibility must not suppress the progress event itself.
	if !e.display.ToolMessages && turn.cp.style == progressStyleCard {
		turn.cp.AppendEvent(ProgressEntryToolUse, "", event.ToolName, "")
	}
	if rv.has {
		// When tool messages are suppressed, skip card updates on tool events.
		if !e.display.ToolMessages {
			return turnFlowContinue
		}
		turn.toolSteps = append(turn.toolSteps, ToolStep{
			Kind:    ToolStepKindTool,
			Name:    event.ToolName,
			Summary: truncateIf(event.ToolInput, e.display.ToolMaxLen),
		})
		e.showRichStepCard(turn, p, rv, CardStatusWorking, "initial tool card", "tool card")
		return turnFlowContinue
	}
	// When tool messages are hidden, behavior depends on display mode:
	//   quiet:   append separator to keep all text in one card
	//   compact: freeze+detach to split text into separate cards
	if !e.display.ToolMessages && len(turn.textParts) > turn.segmentStart && (turn.streamCard == nil || turn.streamCard.Failed()) {
		if e.display.Mode == "quiet" {
			if turn.sp.canPreview() && turn.sp.appendSeparator("\n\n") {
				turn.textParts = append(turn.textParts, "\n\n")
			}
		} else {
			if turn.sp.canPreview() {
				if !turn.freezePreview() {
					return turnFlowReturn
				}
				turn.sp.detachPreview()
			} else {
				segment := stripSilentReply(joinReplyParts(turn.textParts[turn.segmentStart:]))
				if segment != "" {
					turn.sendReplySegment(p, turn.replyCtx, segment)
				}
			}
			turn.segmentStart = len(turn.textParts)
		}
		turn.silentHold = false
	}
	if e.display.ToolMessages {
		// --- StreamingCard path ---
		if turn.streamCard != nil && !turn.streamCard.Failed() {
			toolInput := event.ToolInput
			formattedInput := formatToolInputForChat(event.ToolName, toolInput)
			turn.cardToolCalls = append(turn.cardToolCalls, cardToolEntry{
				Index: turn.toolCount,
				Name:  event.ToolName,
				Input: formattedInput,
			})
			_ = authorizedOutput(turn.outputCtx, func() error {
				return turn.streamCard.Update(turn.outputCtx, turn.streamCardContent())
			})
			return turnFlowContinue // skip original independent message sending
		}
		// --- Original path (fallback) ---
		// Flush accumulated text segment before tool display
		previewActive := turn.sp.canPreview()
		if len(turn.textParts) > turn.segmentStart {
			if !previewActive {
				segment := stripSilentReply(joinReplyParts(turn.textParts[turn.segmentStart:]))
				if segment != "" {
					turn.sendReplySegment(p, turn.replyCtx, segment)
				}
			}
		}
		if !turn.freezePreview() {
			return turnFlowReturn
		}
		turn.segmentStart = len(turn.textParts)
		turn.silentHold = false
		if previewActive {
			turn.sp.detachPreview() // keep frozen preview visible as permanent message
		}
		toolInput := event.ToolInput
		formattedInput := formatToolInputForChat(event.ToolName, toolInput)
		toolMsg := fmt.Sprintf(e.i18n.T(MsgTool), turn.toolCount, event.ToolName, formattedInput)
		// Truncate the tool input that goes into the progress card payload so
		// tool_max_len applies uniformly to progress_style=card, matching
		// the rich-card path. event.ToolInput itself is left untouched.
		cardToolInput := truncateIf(toolInput, e.display.ToolMaxLen)
		if turn.cp.style == progressStyleCard {
			// maomao fork: the card keeps the whole tool input (#1197).
			cardToolInput = toolInput
		}
		if !turn.cp.AppendEvent(ProgressEntryToolUse, cardToolInput, event.ToolName, toolMsg) {
			for _, chunk := range SplitMessageCodeFenceAware(toolMsg, maxPlatformMessageLen) {
				turn.sendWorkspace(p, turn.replyCtx, chunk)
			}
		}
	}
	return turnFlowNext
}

// onTurnToolResult shows one tool result and ends the turn when images piled
// up inside it.
func (e *Engine) onTurnToolResult(turn *interactiveTurn, p Platform, rv richCardView, event Event) turnFlow {
	e.emitToolDone(turn.sessionKey, event, turn.toolStartAt)
	if !e.display.ToolMessages && turn.cp.style == progressStyleCard {
		turn.cp.AppendStructured(ProgressCardEntry{
			Kind: ProgressEntryToolResult, Tool: event.ToolName,
			Status: event.ToolStatus, ExitCode: event.ToolExitCode, Success: event.ToolSuccess,
		}, "")
	}
	// maomao fork: images piled up inside this turn; interrupt it the way an
	// idle timeout does (close the agent session) and leave a fresh session
	// with a handoff for the next message. The turn is not re-run.
	// A strict voice-input turn (input != nil) must finish on its bound
	// thread, as at turn start.
	if turn.input == nil {
		if notice := e.freshOnImageBloatMidTurn(turn.replyAgent, turn.session); notice != "" {
			turn.sessions.Save()
			turn.cp.Finalize(ProgressCardStateFailed)
			turn.sp.discard()
			if !e.noticeKeptOut(p, turn.replyCtx, notice) {
				turn.sendOutput(p, markSystemNotice(p, turn.replyCtx), notice)
			}
			e.cleanupInteractiveState(turn.sessionKey, turn.state)
			return turnFlowReturn
		}
	}
	if e.display.ToolMessages {
		result := strings.TrimSpace(event.ToolResult)
		if result == "" {
			result = strings.TrimSpace(event.Content)
		}
		cardResult := result
		if result != "" {
			result = truncateIf(result, e.display.ToolMaxLen)
		}
		// maomao fork: the card keeps the whole tool output, paged in 细节 (#1197/#1231).
		cardResult = truncateIf(cardResult, cardToolResultMaxLen)
		if result != "" || event.ToolStatus != "" || event.ToolExitCode != nil || event.ToolSuccess != nil {
			if rv.has {
				turn.toolSteps = mergeRichToolResult(turn.toolSteps, event, result, e.display.ToolMaxLen)
				e.showRichStepCard(turn, p, rv, CardStatusWorking, "tool-result card", "tool-result card")
				return turnFlowContinue
			}
			resultMsg := e.formatToolResultEventFallback(event.ToolName, result, event.ToolStatus, event.ToolExitCode, event.ToolSuccess)
			entry := ProgressCardEntry{
				Kind:     ProgressEntryToolResult,
				Tool:     event.ToolName,
				Text:     cardResult,
				Status:   event.ToolStatus,
				ExitCode: event.ToolExitCode,
				Success:  event.ToolSuccess,
			}
			if !turn.cp.AppendStructured(entry, resultMsg) {
				if !SuppressStandaloneToolResultEvent(p) {
					_ = authorizedOutput(turn.outputCtx, func() error { e.sendRaw(p, markAgentReply(p, turn.replyCtx, turn.session), resultMsg); return nil })
				}
			}
		}
	}
	return turnFlowNext
}

// onTurnText adds one chunk of the answer to the turn and its live previews.
func (e *Engine) onTurnText(turn *interactiveTurn, p Platform, rv richCardView, event Event) turnFlow {
	content := event.Content
	if e.display.HideAgentFooter {
		content = stripAgentFooterLines(content)
	}
	if content != "" && !isEllipsisOnly(content) {
		// A tool/thinking boundary commits the previous preview. The
		// next public text opens a new one, even before the next tool
		// or final result (including an answer to a mid-turn insert).
		turn.sp.unfreeze()
		// Pre-compute silentHold transition including this chunk so the
		// rich-card path doesn't leak a preview that gets recalled at
		// end-of-stream when the text resolves to bare NO_REPLY (Lark
		// renders the recall as "撤回了一条消息"). Both rich and legacy
		// paths share this single transition; couldBeSilentPrefix is
		// monotonically decreasing as segments grow, so the transition
		// is held → released at most once per segment.
		peekSegment := strings.Join(turn.textParts[turn.segmentStart:], "") + content
		prevHold := turn.silentHold
		turn.silentHold = couldBeSilentPrefix(peekSegment)
		releasedNow := prevHold && !turn.silentHold

		handledByStreamCard := false
		if turn.streamCard != nil && !turn.streamCard.Failed() {
			turn.textParts = append(turn.textParts, content) // always accumulate for history
			if !turn.silentHold {
				if releasedNow {
					// Write the full held segment so stripSilentReply preserves line boundaries
					// across chunks and doesn't merge subsequent NO_REPLY lines into prior text.
					turn.cardAnswerText.WriteString(peekSegment)
				} else {
					turn.cardAnswerText.WriteString(content)
				}
				_ = authorizedOutput(turn.outputCtx, func() error {
					return turn.streamCard.Update(turn.outputCtx, turn.streamCardContent())
				})
			}
			handledByStreamCard = true
		}
		if !handledByStreamCard {
			if len(turn.textParts) == 0 {
				if rv.has {
					if turn.cardMessageID == nil && !turn.silentHold {
						card := rv.build(CardStatusWorking, "", turn.toolSteps, stripSilentReply(turn.partialText), true, e.composeRichStatusFooter(true, turn.turnStart, e.agent, turn.agentSession, turn.state.workspaceDir))
						if starter, ok := p.(PreviewStarter); ok {
							handle, err := authorizedOutputValue(turn.outputCtx, func() (any, error) {
								return starter.SendPreviewStart(turn.outputCtx, markAgentReply(p, turn.replyCtx, turn.session), card)
							})
							if err != nil {
								slog.Debug("rich card: failed to create initial text card", "platform", p.Name(), "error", err)
							} else {
								turn.cardMessageID = handle
							}
						}
					}
				} else if !turn.silentHold {
					turn.sp.setStatus(CardStatusWorking)
				}
			}
			turn.textParts = append(turn.textParts, content)
			turn.partialText += content
			if rv.has {
				if !turn.silentHold {
					// Lazy creation: if we held during the first text events and
					// only released this chunk, the initial-create branch above
					// won't fire (textParts is non-empty by now). Build the card
					// here using the accumulated partialText so the card emerges
					// with the post-prefix content already in body.
					if turn.cardMessageID == nil {
						card := rv.build(CardStatusWorking, "", turn.toolSteps, stripSilentReply(turn.partialText), true, e.composeRichStatusFooter(true, turn.turnStart, e.agent, turn.agentSession, turn.state.workspaceDir))
						if starter, ok := p.(PreviewStarter); ok {
							handle, err := authorizedOutputValue(turn.outputCtx, func() (any, error) {
								return starter.SendPreviewStart(turn.outputCtx, markAgentReply(p, turn.replyCtx, turn.session), card)
							})
							if err != nil {
								slog.Debug("rich card: failed to create deferred text card", "platform", p.Name(), "error", err)
							} else {
								turn.cardMessageID = handle
							}
						}
					}
					// Throttle: cardkit-v1 streaming text path uses tighter limits (200ms / 20 chars)
					// for smoother typewriter UX; full-card Patch fallback keeps the original 1500ms / 30 chars.
					streamer, hasStreamer := p.(RichCardTextStreamer)
					throttleDur := 1500 * time.Millisecond
					throttleChars := 30
					if hasStreamer && turn.cardMessageID != nil {
						throttleDur = 200 * time.Millisecond
						throttleChars = 20
					}
					if turn.cardMessageID != nil && (time.Since(turn.lastRichCardUpdate) > throttleDur || len(turn.partialText)-turn.lastRichCardLen > throttleChars) {
						// Prefer per-element streaming text update (cardkit-v1) when available;
						// it engages Lark's native typewriter rendering. Falls back to
						// full-card Patch on ErrNotSupported (handle without cardID) or any error.
						streamed := false
						cardBody := stripSilentReply(turn.partialText)
						if hasStreamer {
							streamBody := rv.resolve(cardBody, false)
							if err := authorizedOutput(turn.outputCtx, func() error { return streamer.StreamRichCardText(turn.outputCtx, turn.cardMessageID, streamBody) }); err == nil {
								turn.lastRichCardUpdate = time.Now()
								turn.lastRichCardLen = len(turn.partialText)
								streamed = true
							} else if !errors.Is(err, ErrNotSupported) {
								slog.Debug("rich card: streaming text update failed, falling back to full Patch", "platform", p.Name(), "error", err)
							}
						}
						if !streamed {
							card := rv.build(CardStatusWorking, "", turn.toolSteps, cardBody, true, e.composeRichStatusFooter(true, turn.turnStart, e.agent, turn.agentSession, turn.state.workspaceDir))
							if updater, ok := p.(MessageUpdater); ok {
								if err := authorizedOutput(turn.outputCtx, func() error { return updater.UpdateMessage(turn.outputCtx, turn.cardMessageID, card) }); err == nil {
									turn.lastRichCardUpdate = time.Now()
									turn.lastRichCardLen = len(turn.partialText)
								} else {
									slog.Debug("rich card: failed to update text card", "platform", p.Name(), "error", err)
								}
							}
						}
					}
				}
			} else {
				if !turn.silentHold && turn.sp.canPreview() {
					if releasedNow {
						turn.sp.appendText(peekSegment) // flush all held chunks at once
					} else {
						turn.sp.appendText(content)
					}
				}
			}
		}
	}
	if content != "" && !isEllipsisOnly(content) {
		// #618 K4: text is recorded but never clears the no-progress count;
		// only a tool step does (handoff: 文本不清零、只工具步清零).
		e.journalProgress(turn.sessionKey, "", content, false)
	}
	if event.SessionID != "" {
		e.journalSessionID(turn.sessionKey, event.SessionID) // #618 K4
		e.journalAgentProcess(turn.sessionKey, turn.state)   // #618 K4: codex exec pid starts inside Send
		wasEmpty := turn.session.GetAgentSessionID() == ""
		if turn.session.GetAgentSessionID() != event.SessionID {
			turn.session.SetAgentSessionID(event.SessionID, e.agent.Name())
			if wasEmpty {
				pendingName := turn.session.GetName()
				if pendingName != "" && pendingName != "session" && pendingName != "default" {
					turn.sessions.SetSessionName(event.SessionID, pendingName)
				}
			}
			turn.sessions.Save()
		}
	}
	return turnFlowNext
}

// onTurnPermissionRequest asks the user to approve a tool call (or answers it
// at once in approve-all mode) and waits for the answer.
func (e *Engine) onTurnPermissionRequest(turn *interactiveTurn, p Platform, rv richCardView, event Event) turnFlow {
	// extension_select is a Pi extension UI request routed via the
	// AskUserQuestion rich-card path. The pi session adapter populates
	// event.Questions so it renders as a button card (same UX as Claude
	// Code's AskUserQuestion).
	//
	// extension_confirm is intentionally NOT in this list: extensions
	// use ctx.ui.confirm() to ask the user for permission on a tool
	// call (e.g. permission-gate on Bash), and the engine must render
	// it as a regular permission request (Allow/Deny) so the UX
	// matches other agents. See forwardConfirm in agent/pi/session.go.
	isAskQuestion := (event.ToolName == "AskUserQuestion" ||
		event.ToolName == "extension_select") && len(event.Questions) > 0

	turn.state.mu.Lock()
	autoApprove := turn.state.approveAll || isYoloMode(turn.state.agent)
	turn.state.mu.Unlock()
	autoApprove = autoApprove || e.turnAutoApproves(turn.state)

	if autoApprove && !isAskQuestion {
		slog.Debug("auto-approving (approve-all)", "request_id", event.RequestID, "tool", event.ToolName)
		_ = e.respondTurnPermission(turn.state, turn.agentSession, event.RequestID, PermissionResult{
			Behavior:     "allow",
			UpdatedInput: event.ToolInputRaw,
		})
		return turnFlowContinue
	}

	// A live card retains ownership of its text across the prompt; only
	// detached previews/plain sends commit a separate segment here.
	previewActive := turn.sp.canPreview()
	if len(turn.textParts) > turn.segmentStart && (turn.streamCard == nil || turn.streamCard.Failed()) {
		if !previewActive {
			segment := stripSilentReply(joinReplyParts(turn.textParts[turn.segmentStart:]))
			if segment != "" {
				turn.sendReplySegment(p, turn.replyCtx, segment)
			}
		}
	}
	if !turn.freezePreview() {
		return turnFlowReturn
	}
	if turn.streamCard == nil || turn.streamCard.Failed() {
		turn.segmentStart = len(turn.textParts)
		turn.silentHold = false
	}
	if previewActive {
		turn.sp.detachPreview() // keep frozen preview visible as permanent message
	}

	slog.Info("permission request",
		"request_id", event.RequestID,
		"tool", event.ToolName,
	)

	pending := &pendingPermission{
		ApprovalID:   newPermissionApprovalID(),
		RequestID:    event.RequestID,
		ToolName:     event.ToolName,
		ToolInput:    event.ToolInputRaw,
		InputPreview: event.ToolInput,
		Questions:    event.Questions,
		Resolved:     make(chan struct{}),
	}
	turn.state.mu.Lock()
	turn.state.pending = pending
	turn.state.mu.Unlock()

	turn.state.mu.Lock()
	permissionPlatform := turn.state.platform
	turn.state.mu.Unlock()
	if isAskQuestion {
		_ = authorizedOutput(turn.outputCtx, func() error {
			e.sendAskQuestionPrompt(permissionPlatform, markAgentReply(permissionPlatform, turn.replyCtx, turn.session), event.Questions, 0)
			return nil
		})
	} else {
		permLimit := e.display.ToolMaxLen
		if permLimit > 0 {
			permLimit = permLimit * 8 / 5
		}
		toolInput := truncateIf(event.ToolInput, permLimit)
		prompt := fmt.Sprintf(e.i18n.T(MsgPermissionPrompt), event.ToolName, toolInput)
		_ = authorizedOutput(turn.outputCtx, func() error {
			e.sendPermissionPrompt(permissionPlatform, turn.replyCtx, e.delegatedPermissionPrompt(permissionPlatform, pending, prompt), event.ToolName, toolInput)
			return nil
		})
	}

	// Stop idle timer while waiting for user permission response;
	// the user may take a long time to decide, and we don't want
	// the idle timeout to kill the session during that wait.
	if turn.idleTimer != nil {
		turn.idleTimer.Stop()
	}

	turn.handlingSince.Store(0) // waiting on the user is not a stuck handler
	// Engine.Stop joins event workers after cancelling the engine.
	// A user may never answer this prompt, and closing the agent
	// cannot wake a goroutine waiting on a different channel.
	select {
	case <-pending.Resolved:
	case <-turn.stopCh:
		return turnFlowReturn
	case <-e.ctx.Done():
		return turnFlowReturn
	}
	if e.ctx.Err() != nil || turn.state.isStopped() {
		return turnFlowReturn
	}
	turn.handlingSince.Store(time.Now().UnixNano())
	slog.Info("permission resolved", "request_id", event.RequestID)

	// The stream preview was frozen+detached when this permission
	// request was emitted, so any subsequent EventText in this turn
	// would otherwise be buffered until EventResult and sent as a
	// single bulk message (regression fixed by
	// fix/stream-preview-after-permission). unfreeze() restores the
	// preview so the post-resolution output opens a fresh streaming
	// card and continues to update incrementally.
	turn.sp.unfreeze()

	// Restart idle timer after permission is resolved
	if turn.idleTimer != nil {
		turn.idleTimer.Reset(e.eventIdleTimeout)
	}
	return turnFlowNext
}

// onTurnResult runs a terminal EventResult through settle, compose, deliver
// and finish (interactive_turn_result.go), then chains a queued turn.
func (e *Engine) onTurnResult(turn *interactiveTurn, p Platform, rv richCardView, event Event) turnFlow {
	// Non-terminal result events (e.g. mid-turn compaction: Claude
	// Code's auto-context-compact emits type:"result" with
	// subtype:"compact"/"compaction" and Done=false) must not trigger
	// turn-completion side effects. Skip them so the outer loop
	// continues to read subsequent tool calls and assistant messages
	// for the same turn. See PR #1272 / issue #481.
	if !event.Done {
		slog.Debug("EventResult: non-terminal result event, continuing event loop",
			"session", turn.session.ID,
			"input_tokens", event.InputTokens,
			"output_tokens", event.OutputTokens,
			"metadata", event.Metadata,
		)
		return turnFlowContinue
	}
	r := &interactiveResult{event: event, p: p, hasRichCard: rv.has, richCardSupporter: rv.supporter, resolveRichCardMarkdown: rv.resolve, buildResolvedRichCard: rv.build}
	if !e.settleTurnResult(turn, r) {
		return turnFlowReturn
	}
	e.composeTurnResult(turn, r)
	if !e.deliverTurnResult(turn, r) {
		return turnFlowReturn
	}
	if !e.finishTurnResult(turn, r) {
		return turnFlowReturn
	}
	switch e.chainQueuedTurn(turn) {
	case turnFlowContinue:
		return turnFlowContinue
	case turnFlowReturn:
		return turnFlowReturn
	}
	e.endTurnResult(turn, r)
	return turnFlowReturn
}

// onTurnError ends the turn on an agent error: retry, cooldown, fresh
// session or an error message to the user.
func (e *Engine) onTurnError(turn *interactiveTurn, p Platform, rv richCardView, event Event) turnFlow {
	turn.turnFailed = true
	// Match observeQuotaEventFor's structured and textual quota signals.
	// Quota cooling/takeover owns this interruption even before its async
	// owner transfer; preserve previous work failures, including when the
	// provider supplied no usable reset deadline.
	_, quotaExhausted := QuotaExhaustedReset(event)
	if event.Error != nil {
		raw := strings.ToLower(event.Error.Error())
		quotaExhausted = quotaExhausted || strings.Contains(raw, "quota") || strings.Contains(raw, "resource_exhausted")
	}
	if quotaExhausted {
		turn.watchTurnFinished = true
	}
	// A tool may already have changed external state, even when its
	// progress is hidden. Only capacity failures before tools can replay
	// the user prompt, including queued turns and cooldown redelivery.
	errClass := classifyEventError(event)
	retryCapacity := turn.input == nil && turn.toolCount == 0 && !turn.mediaAttempted && (errClass == errClassCapacity || errClass == errClassRateLimit || errClass == errClassTransient)
	if !retryCapacity && turn.input == nil && turn.toolCount == 0 && !turn.mediaAttempted && errClass == errClassRetryOnce {
		turn.state.mu.Lock()
		retryCapacity = turn.state.capacityAttempt <= 1 // #134: these get one re-send; a second failure is a normal one
		turn.state.mu.Unlock()
	}
	turn.state.mu.Lock()
	turn.state.turnErrored = true // a turn that ends in error never means "the model is back"
	abortedTurn := turn.state.turnCancelled
	turn.state.mu.Unlock()
	turn.cp.Finalize(errorTurnCardState(abortedTurn))
	if event.Error != nil {
		if until, ok := e.quotaCoolingUntilFor(turn.state.quotaScope, event.Error.Error()); ok {
			slog.Warn("provider quota exhausted, cooling down until reset", "session_key", turn.sessionKey, "cooling_until", until.Format(time.RFC3339))
		}
	}
	if retryCapacity {
		turn.board.hold() // maomao fork: re-sent by the capacity retry; one board row, no failure
	} else {
		turn.board.finish(turn.state, BoardDoneFailed)
	}
	inputErr := event.Error
	if inputErr == nil {
		inputErr = fmt.Errorf("agent error without details")
	}
	turn.input.finish(inputTurnResult{err: inputErr})
	turn.sp.discard()
	// An error may still carry an answer. Display it separately, without
	// marking the turn successful or adding it to successful history/API.
	errorAnswer := strings.TrimSpace(event.Content)
	if e.display.HideAgentFooter {
		errorAnswer = stripAgentFooterLines(errorAnswer)
	}
	errorAnswer = strings.TrimSpace(ctxSelfReportRe.ReplaceAllString(errorAnswer, ""))
	if isSilentReply(errorAnswer) {
		errorAnswer = ""
	}
	turn.state.mu.Lock()
	turn.state.eventsNeedResync = true
	cancelledByStop := turn.state.turnCancelled
	turn.state.turnCancelled = false
	turn.state.mu.Unlock()
	errorFooterDelivered := false
	errorAnswerDelivered := false
	if rv.has && turn.cardMessageID != nil {
		cardAnswer := turn.partialText
		if errorAnswer != "" {
			cardAnswer = errorAnswer
		}
		errCard := rv.build(CardStatusError, "", turn.toolSteps, cardAnswer, false, e.composeRichStatusFooter(false, turn.turnStart, turn.replyAgent, turn.agentSession, turn.workspaceDir))
		if updater, ok := p.(MessageUpdater); ok {
			if err := authorizedOutput(turn.outputCtx, func() error { return updater.UpdateMessage(turn.outputCtx, turn.cardMessageID, errCard) }); err != nil {
				slog.Debug("rich card: failed to update error card", "platform", p.Name(), "error", err)
			} else {
				errorFooterDelivered = true
				errorAnswerDelivered = errorAnswer != ""
			}
		}
	}
	if event.Error != nil {
		errMsg := event.Error.Error()
		slog.Error("agent error", "error", event.Error)
		e.emitEvent(HookEvent{
			Event:      HookEventError,
			SessionKey: turn.sessionKey,
			Platform:   p.Name(),
			Error:      event.Error.Error(),
		})
		if cancelledByStop {
			// maomao fork: the user (/stop) or the gate (abort) cancelled this turn and was
			// already told so; the agent's resulting error is expected — log only.
			slog.Info("agent error after turn cancel suppressed", "session", turn.sessionKey, "error", errMsg)
			// The idle watch follows the same rule: someone ended this turn on purpose, so
			// its error is not the watched board item's failure. 2026-11-06 06:05:49 board
			// #170 counted a gate abort ("要她停") as its third failure and was stopped.
			// A turn nobody interrupted never takes this branch and still counts.
			turn.turnFailed = false
		} else if e.isStoppingForJournal() {
			// #618 K4 M2: the bridge is stopping and ended this turn; it is kept in
			// the journal and resumed after the restart, so it is no failure.
			slog.Info("agent error during shutdown suppressed", "session", turn.sessionKey, "error", errMsg)
		} else if retryCapacity {
			// maomao fork: retried / cooled down by runTurnWithCapacityRetry, which tells the user.
			// A queued message chained into this loop goes back to the queue head,
			// so the drain loop retries it (not the turn this loop started with).
			// A local input turn reports the error to its caller instead.
			//
			// The idle watch follows the same rule as for a scheduled or interrupted
			// turn: this failure belongs to the model, not to the watched item.
			// board.hold() above already declares "re-sent, one board row, no failure";
			// an exhausted retry only cools down and re-delivers the same message, so
			// counting this attempt would stop a board item that never failed. Live
			// 2026-11-06 19:15 and 20:54 a relay 429 failed a workspace turn three
			// times, the watch took all three (fails=3, reported=true) and asked the
			// primary role to reassign work nobody had failed at.
			turn.turnFailed = false
			turn.state.mu.Lock()
			if turn.chainedQueued != nil {
				turn.state.pendingMessages = append([]queuedMessage{*turn.chainedQueued}, turn.state.pendingMessages...)
			} else {
				turn.state.capacityFailed = true
				turn.state.capacityErr = errMsg
				turn.state.capacityClass = errClass
				turn.keepLeadHandoffForRetry = true
			}
			turn.state.mu.Unlock()
		} else if turn.input == nil && isPromptTooLongError(errMsg) {
			// maomao fork: the caller of runTurnWithCapacityRetry re-runs it on a fresh
			// session (retryFreshOnPromptTooLong), or reports the error if it cannot.
			turn.state.mu.Lock()
			turn.state.promptTooLong, turn.state.promptTooLongQueued = errMsg, nil
			if turn.chainedQueued != nil {
				q := *turn.chainedQueued
				turn.state.promptTooLongQueued = &q
			}
			turn.state.mu.Unlock()
		} else if turn.input == nil && e.takeResumeFirstError(turn.state, errMsg, turn.chainedQueued) {
			// #618 K4 S1 (after capacity / prompt-too-long): re-run on a fresh session by the caller.
			slog.Warn("resumed turn failed at once; re-running on a fresh session", "session", turn.sessionKey, "error", errMsg)
		} else {
			// #1514: the request of this turn stays unfinished in the agent context;
			// the next user turn is told it is not its work (interrupted_turn.go).
			turn.session.markInterrupted()
			detail := errMsg
			if errors.Is(event.Error, ErrTaskAlreadyCompleted) {
				detail = e.i18n.T(MsgTaskAlreadyCompleted)
			}
			userMsg := e.agentErrorMessage(detail)
			if backendMsg, ok := BackendUnavailableText(event.Error, e.i18n.CurrentLang()); ok {
				userMsg = backendMsg
			}
			if errors.Is(event.Error, ErrEmptyAgentResponse) {
				userMsg = e.i18n.T(MsgEmptyAgentResponse)
			}
			if errors.Is(event.Error, ErrNoPublicAnswer) {
				userMsg = e.i18n.T(MsgNoPublicAnswer)
			}
			for _, h := range agentErrorHandlers {
				if strings.Contains(errMsg, h.contains) {
					userMsg = e.i18n.T(h.msgKey)
					break
				}
			}
			if errorAnswer != "" {
				if !errorAnswerDelivered {
					sendChunksWithStatusFooter(turn.outputCtx, p, turn.replyCtx, errorAnswer, "", turn.sendWorkspaceWithError)
				}
				userMsg = e.i18n.Tf(MsgAnswerWithFailure, detail)
			}
			// The answer does not replace the provider's typed quota notice.
			if reset, ok := QuotaExhaustedReset(event); ok {
				userMsg = e.quotaExhaustedMessage(reset, turn.agentSession, turn.replyAgent)
			}
			// Quota describes the account/model, not whether this turn succeeded.
			// Keep failures on the error path while showing the same measured
			// status (or explicit query failure) as a successful reply.
			var statusFooter string
			if !errorFooterDelivered {
				statusFooter = e.buildClaudeStatusLineFooter(turn.replyAgent, turn.agentSession, turn.workspaceDir)
				if statusFooter == "" {
					statusFooter = e.buildReplyFooter(turn.replyAgent, turn.agentSession, turn.workspaceDir, "")
				}
			}
			// Same rule as the unsolicited-error path above: the group
			// must not receive the backend's raw error text.
			if !e.errorKeptOutOfChat(p, turn.replyCtx, userMsg) {
				sendChunksWithStatusFooter(turn.outputCtx, p, turn.replyCtx, userMsg, statusFooter, func(p Platform, replyCtx any, content string) error {
					return e.sendWithErrorContext(turn.outputCtx, p, replyCtx, content)
				})
			}
		}
	}
	// Retire a dead process just as the channelClosed path does. Keeping
	// it in interactiveStates makes the next turn's startup look like a
	// dead running session, so another cooldown delivery cannot queue.
	// Some agents (e.g. Codex) emit EventError for per-turn failures
	// while keeping the session alive for subsequent turns.
	if turn.agentSession == nil || !turn.agentSession.Alive() {
		turn.retireExitedProcess = true
	}
	return turnFlowReturn
}

// finishClosedTurn ends a turn whose agent event channel closed: the agent
// process exited. It settles the turn and sends the text it had so far.
func (e *Engine) finishClosedTurn(turn *interactiveTurn) {
	// Channel closed - process exited unexpectedly
	slog.Warn("agent process exited", "session_key", turn.sessionKey)
	// Cleanup marks the state stopped even for a crash. Settle the work
	// before cleanup so that bookkeeping cannot disguise an unexpected exit
	// as an intentional stop. Shutdown, user stops and scheduled turns keep
	// their existing exclusion rules.
	if !turn.watchTurnFinished && !turn.state.isStopped() && e.ctx.Err() == nil && !e.isStoppingForJournal() {
		turn.state.mu.Lock()
		p, scheduled, cancelled := turn.state.platform, turn.state.turnScheduled, turn.state.turnCancelled
		turn.state.mu.Unlock()
		if !cancelled {
			e.watchTurnEnded(p, turn.sessionKey, "", turn.toolCount > 0, true, scheduled, e.watchCardResult(turn.state), turn.turnStart)
		}
	}
	turn.watchTurnFinished = true
	if e.ctx.Err() == nil {
		turn.board.finish(turn.state, BoardDoneFailed) // maomao fork: channel task board
	}
	turn.state.mu.Lock()
	turn.state.eventsNeedResync = true
	turn.state.mu.Unlock()
	e.notifyDroppedQueuedMessages(turn.state, fmt.Errorf("agent process exited"))
	e.cleanupInteractiveState(turn.sessionKey, turn.state)

	if len(turn.textParts) > 0 {
		turn.state.mu.Lock()
		p := inputOutputPlatform(turn.state.platform, turn.input)
		turn.state.mu.Unlock()

		fullResponse := joinReplyParts(turn.textParts)
		turn.session.AddHistory("assistant", fullResponse)
		// Persist immediately — this path runs on abnormal channel close,
		// so deferring the save until the next foreground turn risks losing
		// the partial assistant response if the process exits next.
		turn.sessions.Save()

		turn.state.mu.Lock()
		closedTurnSent := append(append([]string(nil), turn.sentReplySegments...), turn.state.turnSentTexts...)
		turn.state.turnSentTexts = nil
		turn.state.sideText = ""
		turn.state.mu.Unlock()
		closedFinalReplyText := func(text string) string {
			return unsentFinalReplyText(p, text, closedTurnSent)
		}

		// Respect NO_REPLY even on abnormal exit so silent turns stay silent.
		if isSilentReply(fullResponse) {
			turn.sp.discard()
			slog.Info("silent reply suppressed (channel closed)", "session", turn.session.ID)
			return
		}
		if stripped := stripSilentReply(fullResponse); stripped != fullResponse {
			if strings.TrimSpace(stripped) == "" {
				turn.sp.discard()
				return
			}
			fullResponse = stripped
		}
		// Same send-time guard as the normal path: a receipt note addressed to
		// the agent itself is not channel content.
		if suppressesRepeatedReply(p) && isMetaOnlyReply(fullResponse) {
			turn.sp.discard()
			slog.Info("meta-only reply suppressed (channel closed)", "session", turn.session.ID)
			return
		}

		if turn.input == nil {
			e.emitEvent(HookEvent{
				Event:      HookEventMessageSent,
				SessionKey: turn.sessionKey,
				Platform:   p.Name(),
				Content:    fullResponse,
				Extra:      e.agentHookExtra(turn.session.GetAgentSessionID(), triggerExtra(turn.msgID)),
			})
		}

		// The live card owns the entire streamed answer, including on EOF.
		// It has not committed any detached segments; a failed finalization
		// therefore leaves the complete text available for the ordinary send.
		if turn.streamCard != nil && !turn.streamCard.Failed() {
			finalContent := buildCardContent(turn.cardThinkingText, turn.cardToolCalls, fullResponse)
			if err := authorizedOutput(turn.outputCtx, func() error { return turn.streamCard.Finalize(turn.outputCtx, finalContent) }); err == nil {
				return
			} else {
				slog.Error("streaming card finalize failed on channel close", "error", err)
			}
		}

		// Same rule as the normal end: text before segmentStart already went out (#700).
		if turn.segmentStart > 0 {
			if turn.segmentStart < len(turn.textParts) {
				unsent := joinReplyParts(turn.textParts[turn.segmentStart:])
				unsent = closedFinalReplyText(unsent)
				if unsent == "" {
					turn.sp.discard()
				} else if !turn.sp.finish(unsent, "") {
					for _, chunk := range SplitMessageCodeFenceAware(unsent, maxPlatformMessageLen) {
						if err := turn.sendWorkspaceWithError(p, turn.replyCtx, chunk); err != nil {
							return
						}
					}
				}
			} else {
				turn.sp.discard()
			}
		} else if turn.sp.finish(fullResponse, "") {
			slog.Debug("stream preview: finalized in-place (process exited)")
		} else {
			deliver := closedFinalReplyText(fullResponse)
			if deliver == "" {
				slog.Debug("repeated/meta final reply suppressed (channel closed)")
				return
			}
			for _, chunk := range SplitMessageCodeFenceAware(deliver, maxPlatformMessageLen) {
				if err := turn.sendWorkspaceWithError(p, turn.replyCtx, chunk); err != nil {
					return
				}
			}
		}
	}
}

// showRichStepCard opens the turn's rich card with the steps so far, or
// updates it when it is already open. create and update name the card in the
// debug log when the platform call fails.
func (e *Engine) showRichStepCard(turn *interactiveTurn, p Platform, rv richCardView, status CardStatus, create, update string) {
	if turn.cardMessageID == nil {
		card := rv.build(status, "", turn.toolSteps, turn.partialText, true, e.composeRichStatusFooter(true, turn.turnStart, e.agent, turn.agentSession, turn.state.workspaceDir))
		if starter, ok := p.(PreviewStarter); ok {
			handle, err := authorizedOutputValue(turn.outputCtx, func() (any, error) {
				return starter.SendPreviewStart(turn.outputCtx, markAgentReply(p, turn.replyCtx, turn.session), card)
			})
			if err != nil {
				slog.Debug("rich card: failed to create "+create, "platform", p.Name(), "error", err)
			} else {
				turn.cardMessageID = handle
			}
		}
	} else if updater, ok := p.(MessageUpdater); ok {
		card := rv.build(status, "", turn.toolSteps, turn.partialText, true, e.composeRichStatusFooter(true, turn.turnStart, e.agent, turn.agentSession, turn.state.workspaceDir))
		if err := authorizedOutput(turn.outputCtx, func() error { return updater.UpdateMessage(turn.outputCtx, turn.cardMessageID, card) }); err != nil {
			slog.Debug("rich card: failed to update "+update, "platform", p.Name(), "error", err)
		}
	}
}

// formatToolInputForChat renders a tool call's input for a chat message or
// the streaming card: as is when it already has a code fence, as a fenced
// block when it is long or multi-line, otherwise inline.
func formatToolInputForChat(toolName, toolInput string) string {
	switch {
	case toolInput == "":
		return ""
	case strings.Contains(toolInput, "```"):
		return toolInput
	case strings.Contains(toolInput, "\n") || utf8.RuneCountInString(toolInput) > 200:
		return fmt.Sprintf("```%s\n%s\n```", toolCodeLang(toolName, toolInput), toolInput)
	}
	switch toolName {
	case "shell", "run_shell_command", "Bash":
		return fmt.Sprintf("```bash\n%s\n```", toolInput)
	default:
		return fmt.Sprintf("`%s`", toolInput)
	}
}
