package core

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// turnFlow tells processInteractiveEvents what to do after a step that used
// to be inline in its event loop.
type turnFlow int

const (
	turnFlowNext     turnFlow = iota // go on with the code after the call
	turnFlowContinue                 // continue the event loop with the next event
	turnFlowReturn                   // leave processInteractiveEvents
)

// interactiveResult carries one terminal EventResult through the steps that
// handle it: settle -> compose -> deliver -> finish. The first block is what
// the event loop computed for this iteration; the rest is what an earlier
// step hands to a later one.
type interactiveResult struct {
	event                   Event
	p                       Platform
	hasRichCard             bool
	richCardSupporter       RichCardSupporter
	resolveRichCardMarkdown func(markdown string, final bool) string
	buildResolvedRichCard   func(status CardStatus, title string, steps []ToolStep, markdown string, streaming bool, statusFooter string) string

	fullResponse  string // settle: the turn's answer; compose: the same with the ctx marker and silent marker removed
	terminalReply bool   // settle: the result event itself carried the answer (not the stream ledger)

	baseResponse       string   // compose: what history, hooks and the handback see
	isSilent           bool     // compose: a NO_REPLY turn, nothing is delivered
	statusFooter       string   // compose: footer rendered separately by platforms that can
	legacyStatusFooter string   // compose: the non-CCD footer, also shown inside a rich card
	suppressDuplicate  bool     // compose: the answer equals the text a script already posted
	turnSentTexts      []string // compose: every text scripts posted during this turn
}

// settleTurnResult is the first step for a terminal EventResult: it checks the
// result still belongs to this turn, persists the agent session id, hands the
// turn to a retry when one claims it, and decides which text is the answer.
// It returns false when processInteractiveEvents must return.
func (e *Engine) settleTurnResult(turn *interactiveTurn, r *interactiveResult) bool {
	event, p := r.event, r.p
	turn.cp.Finalize(ProgressCardStateCompleted)
	if turn.input == nil {
		e.emitStreamEvent(StreamEventReply, turn.sessionKey, event.Content, nil)
	}
	// Use agentSession.CurrentSessionID() instead of event.SessionID.
	if turn.input != nil && (event.Error != nil || turn.agentSession.CurrentSessionID() != turn.input.expectedID ||
		(event.SessionID != "" && event.SessionID != turn.input.expectedID) || turn.sessions.ActiveSessionID(turn.sessionKey) != turn.session.ID || turn.session.GetAgentSessionID() != turn.input.expectedID) {
		err := event.Error
		if err == nil {
			err = fmt.Errorf("original session binding changed during input turn")
		}
		turn.input.finish(inputTurnResult{err: err})
		return false
	}
	// event.SessionID may be empty in some cases, causing the agent_session_id
	// to not be persisted to disk, breaking session resume on next startup.
	if turn.state != nil && turn.agentSession != nil {
		if currentID := turn.agentSession.CurrentSessionID(); currentID != "" {
			e.journalSessionID(turn.sessionKey, currentID) // #618 K4
			wasEmpty := turn.session.GetAgentSessionID() == ""
			if turn.session.GetAgentSessionID() != currentID {
				turn.session.SetAgentSessionID(currentID, e.agent.Name())
				if wasEmpty {
					pendingName := turn.session.GetName()
					if pendingName != "" && pendingName != "session" && pendingName != "default" {
						turn.sessions.SetSessionName(currentID, pendingName)
					}
				}
			}
			turn.sessions.Save()
		}
	}

	// #618 K4 S1: a resumed turn whose first result is an error (e.g. a
	// 400 for a tool_use the cut-off turn left dangling) is re-run once
	// on a fresh session by the caller (retryFreshOnResumeError).
	if e.takeResumeFirstResultError(turn.state, turn.input, event, turn.chainedQueued) {
		turn.board.hold()
		turn.sp.discard()
		return false
	}
	// #1414: the upstream classifier refused the turn; re-run once on a fresh session.
	if e.takeRefusalResult(turn.state, turn.input, event, turn.chainedQueued) {
		turn.board.hold()
		turn.sp.discard()
		return false
	}
	// #1562: how a workspace turn ended (the watch and forwards read it); a cheap-lane
	// turn that ended with an API error is re-run on the lead model by the caller.
	e.noteWorkspaceTurnOutcome(turn.sessionKey, event)
	if e.takeCheapLaneFailure(turn.state, turn.input, event, turn.chainedQueued, turn.sessionKey) {
		turn.board.hold()
		turn.sp.discard()
		return false
	}

	// Mark clean exit so unsolicited reader preserves buffered events.
	turn.state.mu.Lock()
	turn.state.eventsNeedResync = false
	// maomao fork: a cancel that raced with a normal end of the turn must not
	// silence the next turn's error (queued turns don't pass the reset at turn start).
	turn.state.turnCancelled = false
	injected := turn.state.injectedReplyCtxs // maomao fork: messages injected mid-turn (gate.go)
	turn.state.injectedReplyCtxs = nil
	turn.state.mu.Unlock()
	turn.replyCtx = mergeInjectedReplies(p, turn.replyCtx, injected)

	if turn.blockedDraft != "" {
		// The rewrite replaces the withdrawn draft; a short addendum (or nothing)
		// goes after it, so the reply is not lost.
		post := strings.Join(turn.textParts[turn.segmentStart:], "")
		if merged := MergeStopBlockedReply(turn.blockedDraft, post); merged != post {
			turn.textParts = append(turn.textParts[:turn.segmentStart], merged)
		}
		turn.blockedDraft = ""
	}
	turn.state.clearStopDraft()

	// A cumulative adapter identifies the bytes it already streamed. Only
	// its new suffix enters the stream ledger; a standalone terminal answer
	// still replaces the open draft. Do not infer ownership from text matches.
	fullResponse := event.Content
	if event.StreamedContentBytes > 0 {
		if tail := event.Content[event.StreamedContentBytes:]; tail != "" {
			turn.textParts = append(turn.textParts, tail)
		}
		fullResponse = ""
	}
	if e.display.HideAgentFooter {
		fullResponse = stripAgentFooterLines(fullResponse)
	}
	// A nonempty terminal result owns the final reply, including an
	// adapter-only error or Stop-hook rewrite. An empty or explicitly
	// cumulative result uses the stream ledger. Display settings cannot choose the
	// answer's source (#703: quiet mode discarded terminal-only text).
	terminalReply := fullResponse != ""
	if !terminalReply && len(turn.textParts) > 0 {
		fullResponse = strings.Join(turn.textParts, "")
	}
	// The adapter marked an exhausted quota; say which bot/model ran out so
	// other bots in the channel are not blamed.
	if reset, ok := QuotaExhaustedReset(event); ok {
		fullResponse = e.quotaExhaustedMessage(reset, turn.agentSession, turn.replyAgent)
		terminalReply = true
	}
	if turn.input != nil && strings.TrimSpace(fullResponse) == "" {
		turn.state.mu.Lock()
		turn.state.eventsNeedResync = true
		turn.state.mu.Unlock()
		turn.input.finish(inputTurnResult{err: fmt.Errorf("agent completed without an answer")})
		return false
	}
	// maomao fork: only now, with a successful terminal result, has the
	// turn carrying the lead handoff really taken over (#274). Send
	// errors, EventError, quota exhaustion and stops leave it pending
	// for a complete retry next turn.
	if event.Error == nil && !turn.state.isStopped() {
		if _, exhausted := QuotaExhaustedReset(event); !exhausted {
			e.confirmLeadHandoff(turn.session)
		}
	}
	if fullResponse == "" {
		turn.state.mu.Lock()
		deliveredMedia := turn.state.turnSentNonText
		turn.state.mu.Unlock()
		if deliveredMedia {
			fullResponse = "NO_REPLY"
		} else {
			fullResponse = e.i18n.T(MsgEmptyResponse)
		}
	}
	r.fullResponse, r.terminalReply = fullResponse, terminalReply
	return true
}

// composeTurnResult turns the settled answer into what is recorded and what
// is shown: history, the silent (NO_REPLY) decision, the footer, the board
// row and the turn log.
func (e *Engine) composeTurnResult(turn *interactiveTurn, r *interactiveResult) {
	event, p := r.event, r.p
	fullResponse := r.fullResponse
	// Strip any agent-self-reported "[ctx: ~XX%]" marker so it does not
	// leak into the delivered text. The on-screen ctx indicator is now
	// rendered exclusively in the reply footer.
	sdkPlausible := event.InputTokens >= 100
	selfPct := parseSelfReportedCtx(fullResponse)
	cleanResponse := ctxSelfReportRe.ReplaceAllString(fullResponse, "")
	cleanResponse = strings.TrimRight(cleanResponse, "\n ")
	baseResponse := cleanResponse

	contextEstimate := estimateTokensWithPendingAssistant(turn.session.GetHistory(0), baseResponse)

	// Evaluate auto-compress trigger (token estimate on user+assistant text,
	// including this turn's assistant reply before it is appended to history).
	if turn.input == nil && e.autoCompressEnabled && e.autoCompressMaxTokens > 0 {
		estimate := contextEstimate
		// 文本估算不含工具输出，远低于真实值（橘 272k 时估算才几万）；有真实用量就取大者。
		if u := replyFooterSessionContextUsage(turn.agentSession); u != nil && u.UsedTokens > estimate {
			estimate = u.UsedTokens
		}
		now := time.Now()
		turn.state.mu.Lock()
		last := turn.state.lastAutoCompressAt
		turn.state.mu.Unlock()
		if estimate >= e.autoCompressMaxTokens && (last.IsZero() || now.Sub(last) >= e.autoCompressMinGap) {
			turn.triggerAutoCompress = true
			turn.state.mu.Lock()
			turn.state.lastAutoCompressTokens = estimate
			turn.state.mu.Unlock()
		}
	}

	// Detect NO_REPLY marker on the base response (before indicators/footer are appended).
	// Three cases:
	//   1. bare marker (isSilentReply)               → fully silent
	//   2. trailing marker with non-empty reasoning  → strip marker, deliver reasoning
	//   3. trailing marker with empty strip result   → fully silent
	// History records the ORIGINAL baseResponse so the agent retains context of its own
	// decision; only the outbound platform text gets rewritten/suppressed.
	turn.session.AddHistory("assistant", baseResponse)
	turn.sessions.Save()

	// A receipt note the agent writes to itself ("（已存好，标签「奶龙」）")
	// is not chat content. Drop a trailing one when nothing but a silent
	// marker would be left, so "NO_REPLY\n\n（已存好…）" still resolves
	// to a silent turn. The note only goes when the rest is silent: a
	// note-shaped aside after real text stays, because it may be the
	// message itself.
	if trimmed, ok := stripTrailingMetaNotes(baseResponse); ok && suppressesRepeatedReply(p) && (trimmed == "" || IsSilentReply(trimmed)) {
		baseResponse = trimmed
		cleanResponse = trimmed
	}

	isSilent := isSilentReply(baseResponse)
	// A reply that is nothing but a receipt note the agent wrote to
	// itself ("(Already replied above with text + sticker.)") is not
	// chat content; treat it as a silent turn instead of posting it.
	if !isSilent && suppressesRepeatedReply(p) && isMetaOnlyReply(baseResponse) {
		isSilent = true
	}
	if !isSilent {
		if stripped, ok := stripTrailingSilent(baseResponse); ok {
			turn.state.mu.Lock()
			scheduled := turn.state.turnScheduled
			turn.state.mu.Unlock()
			// #1188: a cron/timer turn (兜底到点, 工作区上报, later) has no
			// user waiting; text before its NO_REPLY is the agent's plan
			// ("我会先核对…"), not a message. Swallow the whole turn.
			if strings.TrimSpace(stripped) == "" || scheduled {
				isSilent = true
			} else {
				baseResponse = stripped
				cleanResponse = stripped
			}
		}
	}
	if isSilent {
		// A turn that says nothing leaves nothing: take its progress card (and the thread copy) down.
		turn.cp.Retract()
	}

	// #699 C: a reply is not a handback (WorkspaceExit is), nothing is forwarded from it.
	if !isSilent && turn.input == nil {
		e.hooks.Emit(HookEvent{
			Event:      HookEventMessageSent,
			SessionKey: turn.sessionKey,
			Platform:   p.Name(),
			Content:    baseResponse,
			Extra:      e.agentHookExtra(turn.session.GetAgentSessionID(), triggerExtra(turn.msgID)),
		})
	}

	// statusFooter holds the structured CCD-style footer separately so
	// platforms implementing StatusFooterSender / StatusFooterUpdater
	// can render it with smaller/dim styling. Other paths inline-append
	// it via appendReplyFooter as a fallback. The default
	// (non-CCD) reply footer keeps its existing inline behavior since
	// it's a single short line that does not benefit from a separate
	// card element. In rich mode, the inline-append fallback is
	// suppressed — the rich card renders an equivalent statusFooter
	// through BuildRichCard, so re-appending the legacy footer here
	// would double-print model/ctx/workdir into the card body.
	e.noteContextWindow(turn.agentSession.CurrentSessionID(), turn.agentSession)
	var statusFooter string
	var legacyStatusFooter string
	if !isSilent {
		footerUsage := replyFooterSessionContextUsage(turn.agentSession)
		footerContext := replyFooterContextText(footerUsage, e.i18n)
		if e.showContextIndicator {
			// The result event's input_tokens sums every API call of the turn; with no prompt
			// cache reported (gpt-6.1-sol via openai_chat, agentm 2026-11-05) a 50k context
			// read ten times shows "~100%". Prefer the last call's prompt size the session saw.
			if text := sessionContextIndicatorText(footerUsage); text != "" {
				footerContext = text
			} else if sdkPlausible {
				if text := contextIndicatorText(event.InputTokens); text != "" {
					footerContext = text
				}
			} else if selfPct > 0 {
				footerContext = fmt.Sprintf("[ctx: ~%d%%]", selfPct)
			}
		}
		if status := e.buildClaudeStatusLineFooter(turn.replyAgent, turn.agentSession, turn.workspaceDir); status != "" {
			statusFooter = status
		} else if footer := e.buildReplyFooter(turn.replyAgent, turn.agentSession, turn.workspaceDir, footerContext); footer != "" {
			statusFooter = footer
			legacyStatusFooter = footer
		}
	}
	fullResponse = cleanResponse

	// maomao fork: the board row moves to "今天做完的" (a NO_REPLY turn just leaves).
	if isSilent {
		turn.board.finish(turn.state, boardDoneSilent)
	} else {
		turn.board.finish(turn.state, BoardDoneCompleted)
	}
	turnDuration := time.Since(turn.turnStart)
	e.noteWorkspaceTurn(turn.sessionKey, event.Metadata, turnDuration) // #1448 route log
	slog.Info("turn complete",
		"session", turn.session.ID,
		"agent_session", turn.session.GetAgentSessionID(),
		"msg_id", turn.msgID,
		"tools", turn.toolCount,
		"response_len", len(fullResponse),
		"turn_duration", turnDuration,
		"input_tokens", event.InputTokens,
		"output_tokens", event.OutputTokens,
		"silent", isSilent,
	)
	// DEBUG: full assistant response for in-depth debugging.
	if slog.Default().Enabled(e.ctx, slog.LevelDebug) {
		slog.Debug("turn response",
			"session", turn.session.ID,
			"agent_session", turn.session.GetAgentSessionID(),
			"history_len", turn.session.HistoryLen(),
			"response", previewText(fullResponse, 500),
		)
	}

	e.noteUserTurnCompleted(turn.state)
	// A lead turn that handed work to a workspace: its message now belongs to that work.
	turn.state.mu.Lock()
	turnMsgIDs := append([]string{turn.msgID}, turn.state.injectedMsgIDs...)
	turn.state.injectedMsgIDs = nil
	turn.state.mu.Unlock()
	e.noteTurnHandoffs(turn.sessionKey, turnMsgIDs, turn.turnStart)

	normalizedBaseResponse := strings.TrimSpace(baseResponse)
	turn.state.mu.Lock()
	suppressDuplicate := normalizedBaseResponse != "" && normalizedBaseResponse == turn.state.sideText
	turn.state.sideText = ""
	// Scripts (stickers.py -> bin/qq-bridge send) post through the API
	// path, which only remembers the last text in sideText. The final
	// reply must be checked against every text this turn already sent.
	turnSentTexts := append([]string(nil), turn.state.turnSentTexts...)
	turn.state.turnSentTexts = nil
	turn.state.mu.Unlock()
	r.fullResponse, r.baseResponse, r.isSilent = fullResponse, baseResponse, isSilent
	r.statusFooter, r.legacyStatusFooter = statusFooter, legacyStatusFooter
	r.suppressDuplicate, r.turnSentTexts = suppressDuplicate, turnSentTexts
}

// deliverTurnResult puts the final reply on the platform through whichever
// path this turn used (streaming card, rich card, stream preview, plain send).
// It returns false when a send failed and processInteractiveEvents must return.
func (e *Engine) deliverTurnResult(turn *interactiveTurn, r *interactiveResult) bool {
	p := r.p
	hasRichCard, richCardSupporter := r.hasRichCard, r.richCardSupporter
	resolveRichCardMarkdown, buildResolvedRichCard := r.resolveRichCardMarkdown, r.buildResolvedRichCard
	fullResponse, terminalReply, baseResponse, isSilent := r.fullResponse, r.terminalReply, r.baseResponse, r.isSilent
	statusFooter, legacyStatusFooter := r.statusFooter, r.legacyStatusFooter
	suppressDuplicate, turnSentTexts := r.suppressDuplicate, r.turnSentTexts
	replyStart := time.Now()

	// Everything this turn already put in the channel: narration flushed
	// between tool calls plus the texts scripts posted directly
	// (stickers.py -> bin/qq-bridge send). The final reply is compared
	// against the union so a script-sent line is never repeated.
	sentThisTurn := append(append([]string(nil), turn.sentReplySegments...), turnSentTexts...)
	finalReplyText := func(text string) string {
		return unsentFinalReplyText(p, text, sentThisTurn)
	}

	// --- StreamingCard path ---
	if turn.streamCard != nil && !turn.streamCard.Failed() {
		turn.sp.finish("", "") // cleanup preview (should be no-op if card was active)
		// Silent reply: never render the NO_REPLY marker into the card.
		// cardAnswerText holds only the text streamed BEFORE the marker
		// (empty for a bare NO_REPLY, since silentHold suppresses card
		// writes while the segment is still a NO_REPLY prefix). Finalize
		// with that instead of fullResponse so the card resolves to Done
		// without leaking the marker, and skip the fallback send that
		// would otherwise post the suppressed marker verbatim.
		cardBody := fullResponse
		if isSilent {
			cardBody = strings.TrimRight(turn.cardAnswerText.String(), " \t\r\n")
		}
		finalContent := buildCardContent(turn.cardThinkingText, turn.cardToolCalls, cardBody)
		if err := authorizedOutput(turn.outputCtx, func() error { return turn.streamCard.Finalize(turn.outputCtx, finalContent) }); err != nil {
			slog.Error("streaming card finalize failed, sending fallback", "error", err)
			// Fallback: send the response as a normal message — but never
			// for a silent reply, which has no deliverable content.
			if !isSilent {
				for _, chunk := range SplitMessageCodeFenceAware(fullResponse, maxPlatformMessageLen) {
					if err := turn.sendWorkspaceWithError(p, turn.replyCtx, chunk); err != nil {
						return false
					}
				}
			}
		}
		if isSilent {
			slog.Info("silent reply suppressed", "session", turn.session.ID)
		}
	} else if isSilent {
		// Silent reply: drop any in-flight preview and skip all send paths.
		// sp.discard() clears previewMsgID so sp.needsDoneReaction() also returns false,
		// preventing a stray done_emoji push.
		turn.sp.discard()
		// Rich mode: cardMessageID is tracked independently of sp.previewMsgID,
		// so sp.discard() doesn't reach it. Without explicit handling the rich
		// card would stay frozen in "Working" / "Thinking" header state forever
		// (no Done flip, no Patch).
		//
		// Determine the visible body to finalize the card with. partialText
		// accumulates every EventText chunk this turn, so it captures any
		// pre-NO_REPLY content the user already saw streaming (e.g. when the
		// agent wrote "Hello\nNO_REPLY"). Strip the trailing NO_REPLY marker
		// before rendering. If there is neither body nor tool history, the
		// card has nothing visible worth keeping; delete to avoid an
		// orphaned shell. Finalizing-in-place avoids the "撤回了一条消息"
		// gray bar that DeletePreviewMessage would leave in Lark.
		if hasRichCard && turn.cardMessageID != nil {
			silentBody := turn.partialText
			if stripped, ok := stripTrailingSilent(turn.partialText); ok {
				silentBody = strings.TrimRight(stripped, " \t\r\n")
			}
			if silentBody != "" || len(turn.toolSteps) > 0 {
				card := buildResolvedRichCard(CardStatusDone, "", turn.toolSteps, silentBody, false, e.composeRichStatusFooter(false, turn.turnStart, e.agent, turn.agentSession, turn.state.workspaceDir))
				if updater, ok := p.(MessageUpdater); ok {
					if err := authorizedOutput(turn.outputCtx, func() error { return updater.UpdateMessage(turn.outputCtx, turn.cardMessageID, card) }); err != nil {
						slog.Debug("rich card: failed to finalize card on silent reply", "platform", p.Name(), "error", err)
					}
				}
			} else {
				if cleaner, ok := p.(PreviewCleaner); ok {
					if err := authorizedOutput(turn.outputCtx, func() error { return cleaner.DeletePreviewMessage(turn.outputCtx, turn.cardMessageID) }); err != nil {
						slog.Debug("rich card: failed to delete card on silent reply", "platform", p.Name(), "error", err)
					}
				}
			}
			turn.cardMessageID = nil
		}
		slog.Info("silent reply suppressed", "session", turn.session.ID)
	} else if hasRichCard {
		parts := []string{fullResponse}
		if splitter, ok := p.(MarkdownTableSplitter); ok {
			parts = splitter.SplitMarkdownByTables(fullResponse, 5)
		}
		richStatusFooter := e.composeRichStatusFooter(false, turn.turnStart, e.agent, turn.agentSession, turn.state.workspaceDir)
		if legacyStatusFooter != "" {
			richStatusFooter = formatElapsed(time.Since(turn.turnStart), false, e.i18n.currentLang()) + "\n" + legacyStatusFooter
		}
		finalBody := resolveRichCardMarkdown(parts[0], true)
		finalCard := richCardSupporter.BuildRichCard(CardStatusDone, "", turn.toolSteps, finalBody, false, richStatusFooter)
		if turn.cardMessageID != nil {
			// Forced final flush via cardkit-v1 streaming text update before
			// flipping status to Done via full-card Patch. The throttle in the
			// EventText path may have skipped the last <200ms / <20 chars; this
			// catch-up keeps the typewriter rendering smooth all the way to the
			// end. ErrNotSupported (no cardID) and any error are silent — the
			// subsequent UpdateMessage will rewrite the body anyway.
			if streamer, ok := p.(RichCardTextStreamer); ok {
				if err := authorizedOutput(turn.outputCtx, func() error { return streamer.StreamRichCardText(turn.outputCtx, turn.cardMessageID, finalBody) }); err != nil && !errors.Is(err, ErrNotSupported) {
					slog.Debug("rich card: final streaming flush failed (proceeding to full Patch)", "platform", p.Name(), "error", err)
				}
			}
			if updater, ok := p.(MessageUpdater); ok {
				if err := authorizedOutput(turn.outputCtx, func() error { return updater.UpdateMessage(turn.outputCtx, turn.cardMessageID, finalCard) }); err != nil {
					slog.Debug("rich card: final update failed, falling back to send", "platform", p.Name(), "error", err)
					if err := authorizedOutput(turn.outputCtx, func() error { return p.Send(turn.outputCtx, markFinalReply(p, turn.replyCtx, turn.session), finalCard) }); err != nil {
						slog.Error("failed to send rich card reply", "error", err)
						return false
					}
				}
			}
		} else {
			if err := authorizedOutput(turn.outputCtx, func() error { return p.Send(turn.outputCtx, markFinalReply(p, turn.replyCtx, turn.session), finalCard) }); err != nil {
				slog.Error("failed to send rich card reply", "error", err)
				return false
			}
		}
		for _, overflow := range parts[1:] {
			overflowBody := resolveRichCardMarkdown(overflow, true)
			overflowCard := richCardSupporter.BuildRichCard(CardStatusDone, "", nil, overflowBody, false, richStatusFooter)
			if err := authorizedOutput(turn.outputCtx, func() error {
				return p.Send(turn.outputCtx, markAgentReply(p, turn.replyCtx, turn.session), overflowCard)
			}); err != nil {
				slog.Error("failed to send overflow rich card", "error", err)
				return false
			}
		}
	} else if turn.segmentStart > 0 && !terminalReply {
		// textParts[:segmentStart] already reached the chat: every place that
		// advances segmentStart has sent it as a segment, kept it as a detached
		// preview, or put it in the progress card. The turn end owns only the
		// rest. A thinking step flushes a segment without any tool call, so
		// this must not depend on toolCount (#700: tools=0 turn re-sent both
		// halves glued together). A terminal reply uses the normal flow
		// instead: it can contain text absent from textParts (#703).
		if turn.segmentStart < len(turn.textParts) {
			unsent := strings.Join(turn.textParts[turn.segmentStart:], "")
			unsent = finalReplyText(unsent)
			// The text before the tool call already went out, so the whole-reply
			// NO_REPLY check above does not cover this remainder after a tool call.
			if isSilentReply(unsent) {
				unsent = ""
			} else if stripped, ok := stripTrailingSilent(unsent); ok {
				unsent = stripped
			}
			if unsent == "" {
				turn.sp.discard()
			} else {
				if !turn.sp.finish(unsent, statusFooter) && !sendChunksWithStatusFooter(turn.outputCtx, p, markFinalReply(p, turn.replyCtx, turn.session), unsent, statusFooter, turn.sendWorkspaceWithError) {
					return false
				}
			}
		} else {
			turn.sp.discard()
		}
	} else if suppressDuplicate {
		turn.sp.discard()
		metaOnly := strings.TrimSpace(strings.TrimPrefix(fullResponse, baseResponse))
		if metaOnly != "" || statusFooter != "" {
			if !sendChunksWithStatusFooter(turn.outputCtx, p, markFinalReply(p, turn.replyCtx, turn.session), metaOnly, statusFooter, turn.sendWorkspaceWithError) {
				return false
			}
		}
		slog.Debug("EventResult: suppressed duplicate side-channel text", "response_len", len(fullResponse))
	} else if turn.sp.finish(fullResponse, statusFooter) {
		slog.Debug("EventResult: finalized via stream preview", "response_len", len(fullResponse), "footer_len", len(statusFooter))
	} else {
		// Nothing previewed this text, so the plain send is the only
		// delivery: drop a line a script already posted this turn and a
		// bracketed receipt note addressed to the agent itself.
		deliver := finalReplyText(fullResponse)
		if deliver == "" {
			slog.Debug("EventResult: suppressed repeated/meta final reply", "response_len", len(fullResponse))
			turn.sp.discard()
			if statusFooter != "" {
				if !sendChunksWithStatusFooter(turn.outputCtx, p, markFinalReply(p, turn.replyCtx, turn.session), "", statusFooter, turn.sendWorkspaceWithError) {
					return false
				}
			}
		} else {
			slog.Debug("EventResult: sending via p.Send (preview inactive or failed)", "response_len", len(deliver), "footer_len", len(statusFooter))
			if !sendChunksWithStatusFooter(turn.outputCtx, p, markFinalReply(p, turn.replyCtx, turn.session), deliver, statusFooter, turn.sendWorkspaceWithError) {
				return false
			}
		}
	}

	if elapsed := time.Since(replyStart); elapsed >= slowPlatformSend {
		slog.Warn("slow final reply send", "platform", p.Name(), "elapsed", elapsed, "response_len", len(fullResponse))
	}
	return true
}

// finishTurnResult closes the delivered turn: voice reply, the text-input
// answer, the pending handback, the idle watch, public progress, and
// auto-compress. It returns false when processInteractiveEvents must return.
func (e *Engine) finishTurnResult(turn *interactiveTurn, r *interactiveResult) bool {
	event, p := r.event, r.p
	fullResponse, baseResponse, isSilent := r.fullResponse, r.baseResponse, r.isSilent
	// TTS: async voice reply if enabled (skipped for silent replies)
	if turn.input == nil && !isSilent && e.tts != nil && e.tts.Enabled && e.tts.TTS != nil {
		turn.state.mu.Lock()
		fromVoice := turn.state.fromVoice
		turn.state.mu.Unlock()
		mode := e.tts.GetTTSMode()
		slog.Debug("tts: checking conditions", "mode", mode, "fromVoice", fromVoice, "will_send", mode == "always" || (mode == "voice_only" && fromVoice))
		if mode == "always" || (mode == "voice_only" && fromVoice) {
			go e.sendAuthorizedTTSReply(turn.outputCtx, p, turn.replyCtx, e.publicVoiceReceipt(turn.state, fullResponse))
		}
	} else {
		slog.Debug("tts: not enabled", "tts_nil", e.tts == nil, "enabled", e.tts != nil && e.tts.Enabled, "tts_obj_nil", e.tts == nil || e.tts.TTS == nil)
	}

	// Complete only this API turn, before auto-compress or queued Discord turns.
	if turn.input != nil {
		if turn.pendingSend != nil {
			if err := <-turn.pendingSend; err != nil {
				turn.input.finish(inputTurnResult{err: err})
				return false
			}
			turn.pendingSend = nil
		}
		turn.input.finish(inputTurnResult{text: e.publicVoiceReceipt(turn.state, baseResponse), silent: isSilent})
		turn.input = nil
		turn.state.mu.Lock()
		turn.state.localInputOnly = nil
		turn.state.mu.Unlock()
	}

	progressOutcome := "result"
	if event.Error != nil {
		progressOutcome = "failed"
	}
	if e.publicProgress != nil && turn.pendingSend != nil {
		if err := <-turn.pendingSend; err != nil {
			progressOutcome = "failed"
		}
		turn.pendingSend = nil
	}
	if turn.state.isStopped() {
		progressOutcome = "cancelled"
	}
	turn.watchTurnFinished = true
	turn.state.mu.Lock()
	jobID, retrying := turn.state.currentJobID, turn.state.capacityFailed
	if !retrying {
		turn.state.currentJobID = ""
	}
	turn.state.mu.Unlock()
	if jobID != "" && !retrying {
		text := ""
		if event.Error == nil {
			if _, exhausted := QuotaExhaustedReset(event); !exhausted {
				text = baseResponse // the lead's user-visible answer
			}
		}
		// Reaching here means the final reply was sent (a rejected send returns
		// before this point); settle the pending handback with what the user got.
		e.settleReportWake(jobID, text, nil)
	}
	// The adapters may terminate quota exhaustion with EventResult as well
	// as EventError. It must not erase previous real work failures.
	_, quotaResult := QuotaExhaustedReset(event)
	if !turn.state.isStopped() && !quotaResult {
		e.watchTurnEnded(p, turn.sessionKey, baseResponse, turn.toolCount > 0, false, false, e.watchCardResult(turn.state), turn.turnStart)
	}
	e.finishPublicProgress(turn.state, progressOutcome)

	// Auto-compress after finishing a turn, before sending any queued messages.
	if turn.triggerAutoCompress {
		// Agents with native compaction (codex) compact on their own transport,
		// which needs the session free: queue it for after this turn and the
		// turns queued behind it (applyPendingAutoCompact), as /compact does.
		turn.state.mu.Lock()
		autoAgent := turn.state.agent
		if autoAgent == nil {
			autoAgent = e.agent
		}
		_, native := autoAgent.(NativeContextCompressor)
		if native {
			turn.state.autoCompactDue = true
		}
		turn.state.mu.Unlock()
		if native {
			slog.Info("auto-compress: native compaction queued for after the turn", "session", turn.sessionKey)
		} else if compressor, ok := e.agent.(ContextCompressor); ok && compressor.CompressCommand() != "" {
			if turn.pendingSend != nil {
				if err := <-turn.pendingSend; err != nil {
					slog.Debug("async send error before compress", "error", err)
				}
			}
			turn.state.mu.Lock()
			turn.state.lastAutoCompressAt = time.Now()
			tokenEst := turn.state.lastAutoCompressTokens
			turn.state.mu.Unlock()
			slog.Info("auto-compress: triggering", "session", turn.sessionKey)

			// Notify user before compressing so they know the context is about to change.
			compressNotice := e.i18n.T(MsgCompressing)
			if tokenEst > 0 {
				compressNotice = fmt.Sprintf("%s (~%dk tokens)", compressNotice, tokenEst/1000)
			}
			turn.sendOutput(turn.state.platform, turn.state.replyCtx, compressNotice)

			// Run compress inline while the session is still locked.
			e.runCompress(turn.state, turn.session, turn.sessions, turn.sessionKey, turn.state.platform, turn.state.replyCtx, true)
			return false
		}
	}
	return true
}

// chainQueuedTurn starts the next queued message in the same event loop when
// there is one: turnFlowContinue means a queued turn was started,
// turnFlowReturn means the loop must end now, turnFlowNext means the queue
// was empty (or left to the drain loop).
func (e *Engine) chainQueuedTurn(turn *interactiveTurn) turnFlow {
	// Check for queued messages — if present, continue the event loop
	// for the next turn instead of returning.
	turn.state.mu.Lock()
	// A time limit that claimed the turn that just ended finishes first: a stop that
	// closed the session dropped the queue, so no next turn starts on a dead session.
	if turn.state.awaitScheduledCancelLocked() {
		turn.state.turnCancelled = false // that cancel was for the ended turn, not the next one
	}
	if e.isStoppingForJournal() {
		// #1368: shutdown owns the current journal entry. Leave even
		// stale queued messages untouched for restart recovery.
		turn.state.mu.Unlock()
		return turnFlowReturn
	}
	droppedStale := 0
	var staleDescs []string // maomao fork: channel task board
	e.refreshQueuedTaskReviewsLocked(turn.state)
	for len(turn.state.pendingMessages) > 0 && e.isQueuedUserMessageStaleForDrainLocked(turn.state, turn.state.pendingMessages[0].userMessageTimeMs) {
		staleDescs = append(staleDescs, turn.state.pendingMessages[0].boardDesc)
		turn.state.pendingMessages = turn.state.pendingMessages[1:]
		droppedStale++
	}
	if droppedStale > 0 {
		e.boardDropped(turn.sessionKey, staleDescs)
		slog.Info("dropped stale queued user messages after completed turn",
			"session", turn.sessionKey,
			"dropped", droppedStale,
		)
	}
	// maomao fork: during a capacity cooldown leave the queue to the drain loop, which defers it.
	if len(turn.state.pendingMessages) > 0 && e.capacityWait() == 0 {
		queued := takeQueuedBatchLocked(turn.state) // a burst from one sender runs as one turn
		raw := queued                               // maomao fork: raw copy (content not yet expanded), put back if this turn hits capacity
		turn.chainedQueued = &raw
		remainingQueue := len(turn.state.pendingMessages)
		turn.state.authorization = queued.authorization
		turn.state.platform = queued.platform
		turn.state.replyCtx = queued.replyCtx
		turn.state.injectedReplyCtxs = nil
		turn.state.currentMessageID = queued.messageID
		turn.state.fromVoice = queued.fromVoice
		turn.state.currentTurnUserMessageTimeMs = queued.userMessageTimeMs
		turn.state.turnUserID = queued.userID
		turn.state.markTurnStartLocked()
		turn.state.turnDesc = queued.boardDesc // maomao fork: channel task board
		turn.state.turnScheduled = scheduledTurnUser(queued.userID)
		turn.state.currentJobID = queued.timerJobID
		turn.state.mu.Unlock()
		e.armScheduledTurnTimeout(turn.state, turn.sessionKey, queued.turnTrigger, queued.timerJobID, queued.cronJobID, queued.userID, true)
		turn.unwatch()
		turn.changed, turn.unwatch, turn.watchErr = e.watchTurnAuthorization(queued.authorization)
		turn.outputCtx, turn.contextErr = e.turnOutputContext(queued.authorization)
		if turn.contextErr != nil {
			e.failAuthorizedTurn(queued.authorization)
			e.journalTurnEnd(queued.resumedFrom)
			e.stopInteractiveSessionWithOptions(turn.sessionKey, true)
			return turnFlowReturn
		}

		if turn.watchErr != nil {
			e.failAuthorizedTurn(queued.authorization)
			e.journalTurnEnd(queued.resumedFrom)
			e.stopInteractiveSessionWithOptions(turn.sessionKey, true)
			return turnFlowReturn
		}

		// Stop the previous turn's typing indicator
		if turn.stopTyping != nil {
			turn.stopTyping()
			turn.stopTyping = nil
		}
		// Start a new typing indicator for the queued message's context
		if ti, ok := queued.platform.(TypingIndicator); ok {
			turn.stopTyping = e.startAuthorizedTyping(ti, queued.replyCtx, queued.authorization)
		}
		// Agent continues working — don't add done reaction for this turn.
		turn.doneReaction = nil

		// Drain stale events before starting the next turn. Between
		// EventResult and Send(), the only buffered events would be
		// stale leftovers (e.g. a deferred EventError from cmd.Wait()).
		drainEvents(turn.agentSession.Events())

		if turn.pendingSend != nil {
			if err := <-turn.pendingSend; err != nil {
				slog.Debug("async send error before queued turn", "error", err)
			}
		}

		e.startScheduledQueuedTurn(&queued, turn.session)
		// maomao fork: a capacity retry re-sends it with this backfill, not before it
		// (the backfill already marked those posts seen).
		*turn.chainedQueued = queued
		queued.content = turn.session.renderReference(queued.content, queued.reference)
		queued.content = e.withTurnBlocksRef(turn.session, queued.msgSessionKey, queued.turnCtxQuery, queued.turnCtxSender, queued.content, queued.turnCtx, queued.reference)
		queuedPrompt := e.buildSenderPrompt(withVoiceNote(queued.content, queued.fromVoice && !queued.voiceMarked), queued.userID, queued.userName, queued.msgPlatform, queued.msgSessionKey, queued.channelKey)
		queuedPrompt = e.withSharedMemoryHint(queuedPrompt, turn.replyAgent, &Message{SessionKey: queued.msgSessionKey, ChannelKey: queued.channelKey}, turn.workspaceDir)
		queuedPrompt = e.withChannelAgentInstructions(queuedPrompt, queued.userID, queued.fromBot, queued.platform, queued.msgSessionKey, turn.session, turn.replyAgent)
		e.noteCallerTurn(queued.msgSessionKey, queued.msgPlatform, queued.userID, queued.userName, queued.channelKey, queued.fromBot, queued.timerJobID != "" || queued.cronJobID != "", false)
		queuedPrompt = e.withPublicProgress(queuedPrompt, turn.state, queued.msgSessionKey, queued.fromBot, queued.fromVoice)

		turn.state.mu.Lock()
		as := turn.agentSession // capture under lock to avoid race with cleanup
		turn.state.mu.Unlock()
		// The previous turn's mode ends with that turn; this one runs in its own.
		e.setTurnMode(turn.state, as, queued.modeOverride)
		// #618 K1: the running turn's entry now describes this queued message.
		if id, owned := e.journalQueuedTurn(turn.chainedQueued, turn.sessionKey, turn.workspaceDir, as); owned { // raw text, before the turn blocks
			if turn.chainedJournalID != "" && turn.chainedJournalID != id {
				e.journalTurnEnd(turn.chainedJournalID)
			}
			turn.chainedJournalID = id
		}
		e.journalSyncQueued(turn.state, turn.sessionKey)                              // #618 K4 #12: dequeued
		e.armResumeRetry(turn.state, turn.session, turn.chainedQueued.resumeFallback) // #618 K4 S1 (clears it for a plain message)

		nextSend := make(chan error, 1)
		go func() {
			if as == nil {
				turn.session.SettleHandoff(false)
				nextSend <- fmt.Errorf("agent session became nil")
				return
			}
			err := e.recordTurnAgent(queued.authorization, turn.replyAgent)
			if err == nil {
				err = as.Send(queuedPrompt, queued.messageID, queued.images, queued.files)
			}
			turn.session.SettleHandoff(err == nil) // maomao fork: put an undelivered handoff back
			nextSend <- err
		}()
		turn.pendingSend = nextSend

		// Detect language now (deferred from queue time to avoid
		// flipping locale while the previous turn is still running).
		e.i18n.DetectAndSet(queued.content)

		// Reset per-turn state for the next turn
		turn.msgID = queued.messageID
		turn.textParts = nil
		turn.sentReplySegments = nil
		turn.blockedDraft = ""
		turn.state.mu.Lock()
		turn.state.stopDraft = ""
		turn.state.turnSentTexts = nil
		turn.state.turnSentNonText = false
		turn.state.sideText = ""
		turn.state.mu.Unlock()
		turn.segmentStart = 0
		turn.toolCount = 0
		turn.mediaAttempted = false
		turn.watchTurnFinished = false
		turn.turnStart = time.Now()
		turn.firstEventLogged = false
		turn.modelRetryShown = false
		turn.waitStart = time.Now()
		// Reassign the local replyCtx parameter to the queued message's
		// trigger context. state.replyCtx was updated above, but the
		// function-scope replyCtx is what gets passed to p.Send / p.Reply
		// further down — and platforms derive the parent message_id from
		// it for the reply quote. Without this reassignment, msg2's
		// reply would quote msg1's bubble.
		turn.replyCtx = queued.replyCtx
		// Rich-mode per-turn state must reset too — otherwise EventText for
		// the queued message would StreamRichCardText against the previous
		// turn's cardID, overwriting that card's body with the new turn's
		// content. Same risk for partialText/toolSteps leaking across turns.
		turn.cardMessageID = nil
		turn.toolSteps = nil
		turn.partialText = ""
		turn.lastRichCardUpdate = time.Time{}
		turn.lastRichCardLen = 0
		queuedRenderer := func(content string) string {
			return e.renderOutgoingContentForWorkspace(queued.platform, content, turn.workspaceDir)
		}
		turn.sp = newStreamPreview(e.streamPreview, queued.platform, markAgentReply(queued.platform, queued.replyCtx, turn.session), turn.outputCtx, queuedRenderer)
		turn.cp = newCompactProgressWriter(turn.outputCtx, queued.platform, markAgentReply(queued.platform, queued.replyCtx, turn.session), e.agent.Name(), e.i18n.CurrentLang(), queuedRenderer)
		turn.cp.mirrorFor = e.taskThreadProgressContext(turn.outputCtx, queued.platform, turn.sessionKey, queuedRenderer)
		turn.board = e.boardBegin(turn.state, turn.sessionKey) // maomao fork: the queued turn's board row
		turn.cp.onStep = turn.board.step

		// Reset streaming card state for the next turn
		turn.streamCard = nil
		turn.cardToolCalls = nil
		turn.cardThinkingText = ""
		turn.cardAnswerText.Reset()

		// Try to create a new streaming card for the queued turn
		if scp, ok := queued.platform.(StreamingCardPlatform); ok {
			if sc, err := authorizedOutputValue(turn.outputCtx, func() (StreamingCard, error) { return scp.CreateStreamingCard(turn.outputCtx, queued.replyCtx) }); err != nil {
				slog.Warn("streaming card creation failed for queued turn", "error", err)
			} else {
				turn.streamCard = sc
			}
		}

		// Send instant reply for queued turn if no streaming card is active.
		if e.instantReply.Enabled && turn.streamCard == nil {
			replyContent := e.instantReply.Content
			if replyContent == "" {
				replyContent = e.i18n.T(MsgStarting)
			}
			turn.sendOutput(queued.platform, queued.replyCtx, replyContent)
		}

		turn.session.AddHistory("user", queued.content)
		// Persist queued user message immediately (mirror of the
		// initial AddHistory("user",...) save above).
		turn.sessions.Save()

		if turn.idleTimer != nil {
			if !turn.idleTimer.Stop() {
				select {
				case <-turn.idleTimer.C:
				default:
				}
			}
			turn.idleTimer.Reset(e.eventIdleTimeout)
		}

		slog.Info("processing queued message",
			"session", turn.sessionKey,
			"remaining_queue", remainingQueue,
		)
		return turnFlowContinue
	}
	turn.state.mu.Unlock()
	return turnFlowNext
}

// endTurnResult is the last step when no queued turn follows: wait for the
// prompt send to settle and arm the "done" reaction.
func (e *Engine) endTurnResult(turn *interactiveTurn, r *interactiveResult) {
	p, isSilent, hasRichCard := r.p, r.isSilent, r.hasRichCard

	if turn.pendingSend != nil {
		if err := <-turn.pendingSend; err != nil {
			slog.Debug("async send error after EventResult", "error", err)
		}
	}

	// Add a "done" reaction after the final answer when supported. Skip
	// silent turns and rich card mode (the card itself shows done status).
	if !isSilent && !hasRichCard {
		if doneTI, ok := p.(TypingIndicatorDone); ok {
			reactionCtx := turn.outputCtx
			turn.doneReaction = func() {
				_ = authorizedOutput(reactionCtx, func() error { doneTI.AddDoneReaction(turn.replyCtx); return nil })
			}
		}
	}
}
