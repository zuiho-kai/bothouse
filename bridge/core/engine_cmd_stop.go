package core

import (
	"fmt"
	"log/slog"
	"strings"
	"time"
)

func (e *Engine) cmdStop(p Platform, msg *Message) {
	// /stop only tears down the live agent process; it preserves the stored
	// AgentSessionID so the next message can --resume the conversation. This
	// matches the card-button stop path (see executeCardAction "/stop"). The
	// session-tracking write-back keeps AgentSessionID pointing at Claude's
	// latest forked session, so resuming after /stop is safe and no longer
	// triggers the recycling loop from issue #830.
	iKey := e.interactiveKeyForSessionKey(msg.SessionKey)
	e.revokeInteractiveAuthorization(iKey)
	if !e.stopInteractiveSession(iKey, p, msg.ReplyCtx) {
		// Fallback: try suffix scan in case interactiveKeyForSessionKey
		// resolved a different key than the one used to store the state
		// (e.g. workspace binding lookup inconsistency).
		if found := e.findInteractiveKeyForSession(msg.SessionKey); found != "" && found != iKey {
			e.revokeInteractiveAuthorization(found)
			if e.stopInteractiveSession(found, p, msg.ReplyCtx) {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgExecutionStopped))
				return
			}
		}
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgNoExecution))
		return
	}
	e.reply(p, msg.ReplyCtx, e.i18n.T(MsgExecutionStopped))
}

// cmdCancel stops the current execution and starts a fresh session.
// Unlike /stop which only halts execution, /cancel also resets the session
// so the user can immediately continue with new instructions.
func (e *Engine) cmdCancel(p Platform, msg *Message) {
	_, sessions, interactiveKey, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	slog.Info("cmdCancel: stopping execution and creating new session", "session_key", msg.SessionKey)

	// Stop the current execution (like /stop)
	e.revokeInteractiveAuthorization(interactiveKey)
	stopped := e.stopInteractiveSession(interactiveKey, p, msg.ReplyCtx)
	if !stopped {
		// No execution in progress, but still create a new session
		slog.Debug("cmdCancel: no execution to stop, proceeding with new session", "session_key", msg.SessionKey)
	}

	// Clear old session's agent session ID so it cannot be resumed
	old := sessions.GetOrCreateActive(msg.SessionKey)
	old.SetAgentSessionID("", "")
	old.ClearHistory()
	sessions.Save()

	// Create a new session (like /new)
	sessions.NewSession(msg.SessionKey, "")

	e.reply(p, msg.ReplyCtx, e.i18n.T(MsgSessionCancelled))
}

func (e *Engine) stopInteractiveSession(sessionKey string, quietPlatform Platform, quietReplyCtx any) bool {
	return e.stopInteractiveSessionWithOptions(sessionKey, true)
}

func (e *Engine) stopInteractiveSessionForAbort(sessionKey string) bool {
	return e.stopInteractiveSessionWithQueue(sessionKey, true, true)
}

func (e *Engine) stopInteractiveSessionSilently(sessionKey string) bool {
	return e.stopInteractiveSessionWithOptions(sessionKey, false)
}

func (e *Engine) stopInteractiveSessionWithOptions(sessionKey string, notifyQueued bool) bool {
	return e.stopInteractiveSessionWithQueue(sessionKey, notifyQueued, false)
}

func (e *Engine) stopInteractiveSessionWithQueue(sessionKey string, notifyQueued, keepQueued bool) bool {
	return e.stopInteractiveStateWithQueue(sessionKey, nil, notifyQueued, keepQueued)
}

// stopInteractiveStateWithQueue stops the turn under sessionKey; with want set, only when the
// live state there is still want. A caller that captured a turn's state (a scheduled turn's
// time limit) names it, so a turn that started since on a replacement state is never stopped.
func (e *Engine) stopInteractiveStateWithQueue(sessionKey string, want *interactiveState, notifyQueued, keepQueued bool) bool {
	e.interactiveMu.Lock()
	state, ok := e.interactiveStates[sessionKey]
	if want != nil && state != want {
		e.interactiveMu.Unlock()
		return false
	}
	if op := e.nativeCompactions[sessionKey]; op != nil {
		op.cancel()
		e.interactiveMu.Unlock()
		return true
	}
	if !ok || state == nil {
		e.interactiveMu.Unlock()
		return false
	}

	// Stop unsolicited reader before touching state to avoid races.
	e.stopUnsolicitedReader(state)

	state.mu.Lock()
	pending := state.pending
	state.pending = nil
	agentSession := state.agentSession
	state.mu.Unlock()

	// If the agent session supports graceful turn cancellation (e.g. ACP),
	// send a cancel notification and keep the session alive for the next
	// user message, rather than killing the process and destroying state.
	if canceller, ok := agentSession.(AgentSessionCanceller); ok && agentSession != nil {
		// Keep the state in the map so the next message reuses this session.
		// Don't markStopped — the session is still usable.
		// Don't delete from interactiveStates — keep it alive.
		e.interactiveMu.Unlock()

		if pending != nil {
			pending.resolve()
			pending = nil // not again if CancelTurn fails and normal cleanup runs
		}

		// Mark eventsNeedResync so the next turn drains stale events from
		// the cancelled turn before processing fresh input.
		state.mu.Lock()
		state.eventsNeedResync = true
		state.turnCancelled = true
		state.mu.Unlock()

		cancelErr := canceller.CancelTurn()
		if cancelErr != nil {
			slog.Warn("agent session CancelTurn failed, falling back to Close",
				"session_key", sessionKey, "error", cancelErr)
			// Fall through to normal cleanup below.
			e.interactiveMu.Lock()
			goto normalCleanup
		}
		// maomao fork: only the running turn is cancelled. Messages queued behind it stay
		// queued and are answered by the next turns of this same session (the cancelled
		// turn's drain picks them up); they get no "❌ session cancelled" (review
		// ~/.claude/reviews/agy-abort-reset.md: 「不能无声消失」, user 10-23「取消后不报错」).
		// A silent stop (a recalled message) still drops them, as before.
		if !notifyQueued {
			state.mu.Lock()
			state.pendingMessages = nil
			state.mu.Unlock()
		}

		slog.Info("agent session turn cancelled, session kept alive",
			"session_key", sessionKey)

		e.emitEvent(HookEvent{
			Event:      HookEventSessionEnded,
			SessionKey: sessionKey,
		})

		return true
	}

normalCleanup:
	var closed chan struct{}
	closing := state.agentCloseDone != nil
	if keepQueued {
		state.mu.Lock()
		state.resetHandoff = true
		if closing {
			state.abortCloseDone = state.agentCloseDone
		} else {
			closed = make(chan struct{})
			state.abortCloseDone = closed
		}
		state.mu.Unlock()
	}
	state.markStopped()
	// The turn closer owns the existing completion barrier. Keep it discoverable
	// by the next message until that Close has actually finished; /stop must not
	// start a second close or let the same native session resume prematurely.
	if !closing {
		delete(e.interactiveStates, sessionKey)
	}
	e.interactiveMu.Unlock()

	if pending != nil {
		pending.resolve()
	}
	if notifyQueued {
		e.notifyDroppedQueuedMessages(state, fmt.Errorf("session reset"))
	} else {
		state.mu.Lock()
		state.pendingMessages = nil
		state.mu.Unlock()
	}
	if !closing {
		go e.closeAgentSessionAndSignal(sessionKey, agentSession, closed)
	}

	e.emitEvent(HookEvent{
		Event:      HookEventSessionEnded,
		SessionKey: sessionKey,
	})

	return true
}

func (e *Engine) cmdCompress(p Platform, msg *Message) {
	agent, sessions, iKey, workspaceDir, err := e.commandContextWithWorkspace(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	if native, ok := agent.(NativeContextCompressor); ok {
		e.cmdNativeCompact(agent, native, sessions, iKey, workspaceDir, p, msg)
		return
	}

	compressor, ok := agent.(ContextCompressor)
	if !ok || compressor.CompressCommand() == "" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCompressNotSupported))
		return
	}

	e.interactiveMu.Lock()
	state, hasState := e.interactiveStates[iKey]
	e.interactiveMu.Unlock()

	if !hasState || state == nil {
		// Fallback: suffix scan for multi-workspace key mismatch
		if found := e.findInteractiveKeyForSession(msg.SessionKey); found != "" && found != iKey {
			e.interactiveMu.Lock()
			state, hasState = e.interactiveStates[found]
			e.interactiveMu.Unlock()
		}
	}

	if !hasState || state == nil || state.agentSession == nil || !state.agentSession.Alive() {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCompressNoSession))
		return
	}

	session := sessions.GetOrCreateActive(msg.SessionKey)
	if !session.TryLock() {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPreviousProcessing))
		return
	}

	e.send(p, msg.ReplyCtx, e.i18n.T(MsgCompressing))

	if !e.startMessageWorker(func() { e.runCompress(state, session, sessions, iKey, p, msg.ReplyCtx, false) }) {
		session.Unlock()
	}
}

// runCompress sends the agent's compress command and handles results.
// If autoTriggered is true, suppress user-visible "compressing" and completion messages.
func (e *Engine) runCompress(state *interactiveState, session *Session, sessions *SessionManager, iKey string, p Platform, replyCtx any, auto bool) {
	// session.Unlock() is called inside drainQueuedMessagesAfterCompress
	// while holding state.mu to close the race window. Deferred fallback
	// ensures the lock is released on early-return paths.
	compressUnlocked := false
	defer func() {
		if !compressUnlocked {
			session.Unlock()
		}
	}()

	// Stop unsolicited reader before taking event channel ownership.
	e.stopUnsolicitedReader(state)

	state.mu.Lock()
	state.platform = p
	state.replyCtx = replyCtx
	state.mu.Unlock()

	drainEvents(state.agentSession.Events())

	compressor, ok := e.agent.(ContextCompressor)
	if !ok || compressor.CompressCommand() == "" {
		if !auto {
			e.reply(p, replyCtx, e.i18n.T(MsgCompressNotSupported))
		}
		return
	}

	cmd := compressor.CompressCommand()
	if err := state.agentSession.Send(cmd, "", nil, nil); err != nil {
		if !auto {
			e.reply(p, replyCtx, fmt.Sprintf(e.i18n.T(MsgError), err))
		}
		if !state.agentSession.Alive() {
			e.cleanupInteractiveState(iKey)
		}
		return
	}

	e.processCompressEvents(state, session, sessions, iKey, p, replyCtx, &compressUnlocked, auto)
}

// processCompressEvents drains agent events after a compress command.
// Unlike processInteractiveEvents it does NOT record history and treats
// an empty result as success rather than "(empty response)".
func (e *Engine) processCompressEvents(state *interactiveState, session *Session, sessions *SessionManager, sessionKey string, p Platform, replyCtx any, unlocked *bool, auto bool) {

	var textParts []string
	events := state.agentSession.Events()
	stopCh := state.stopSignal()

	var idleTimer *time.Timer
	var idleCh <-chan time.Time
	if e.eventIdleTimeout > 0 {
		idleTimer = time.NewTimer(e.eventIdleTimeout)
		defer idleTimer.Stop()
		idleCh = idleTimer.C
	}

	for {
		var event Event
		var ok bool

		select {
		case <-stopCh:
			return
		case event, ok = <-events:
			if !ok {
				e.cleanupInteractiveState(sessionKey, state)
				if !auto {
					if len(textParts) > 0 {
						e.send(p, replyCtx, strings.Join(textParts, ""))
					} else {
						e.reply(p, replyCtx, e.i18n.T(MsgCompressDone))
					}
				}
				e.notifyDroppedQueuedMessages(state, fmt.Errorf("agent process exited during compress"))
				return
			}
		case <-idleCh:
			if !auto {
				e.send(p, replyCtx, fmt.Sprintf(e.i18n.T(MsgError), "compress timed out"))
			}
			e.cleanupInteractiveState(sessionKey, state)
			e.notifyDroppedQueuedMessages(state, fmt.Errorf("compress timed out"))
			return
		case <-e.ctx.Done():
			return
		}

		if state.isStopped() {
			return
		}

		if idleTimer != nil {
			if !idleTimer.Stop() {
				select {
				case <-idleTimer.C:
				default:
				}
			}
			idleTimer.Reset(e.eventIdleTimeout)
		}

		switch event.Type {
		case EventText:
			if !auto && event.Content != "" {
				textParts = append(textParts, event.Content)
			}
		case EventToolResult:
			if !auto {
				out := strings.TrimSpace(event.Content)
				if out == "" {
					out = strings.TrimSpace(event.ToolResult)
				}
				// Agents hand over the whole tool output (#1231); text replies keep the old cap.
				out = truncateIf(out, defaultToolMaxLen)
				if out == "" {
					break
				}
				tn := strings.TrimSpace(event.ToolName)
				if tn == "" {
					tn = "tool"
				}
				textParts = append(textParts, fmt.Sprintf(e.i18n.T(MsgToolResult), tn, out)+"\n")
			}
		case EventResult:
			result := event.Content
			if result == "" && len(textParts) > 0 {
				result = strings.Join(textParts, "")
			}
			if !auto {
				if result != "" {
					e.send(p, replyCtx, result)
				} else {
					e.reply(p, replyCtx, e.i18n.T(MsgCompressDone))
				}
			}

			session.ResetTurnCtx() // maomao fork: the next turn resends the context blocks

			// After compress succeeds, process any queued messages instead of dropping them.
			e.drainQueuedMessagesAfterCompress(state, session, sessions, sessionKey, unlocked)
			return
		case EventError:
			if !auto && event.Error != nil {
				e.reply(p, replyCtx, fmt.Sprintf(e.i18n.T(MsgError), event.Error))
			}
			// Only drop queued messages if the agent is dead; some agents
			// emit per-turn EventError while staying alive.
			if !state.agentSession.Alive() {
				e.notifyDroppedQueuedMessages(state, event.Error)
			} else {
				// Agent survived — try to process queued messages.
				e.drainQueuedMessagesAfterCompress(state, session, sessions, sessionKey, unlocked)
			}
			return
		case EventPermissionRequest:
			_ = e.respondTurnPermission(state, state.agentSession, event.RequestID, PermissionResult{
				Behavior:     "allow",
				UpdatedInput: event.ToolInputRaw,
			})
		}
	}
}

// drainQueuedMessagesAfterCompress processes any messages that were queued
// during a /compress operation. It sends each one to the agent and runs the
// full interactive event loop for it.
func (e *Engine) drainQueuedMessagesAfterCompress(state *interactiveState, session *Session, sessions *SessionManager, sessionKey string, unlocked *bool) {
	if e.drainPendingMessages(state, session, sessions, sessionKey) {
		*unlocked = true
	}
}
