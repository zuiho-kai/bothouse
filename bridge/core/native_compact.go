package core

import (
	"context"
	"errors"
	"time"
)

// A separate operation record lets /stop cancel even while the native transport
// is starting, without pretending it is a normal chat session or queuing prompts.
type nativeCompaction struct{ cancel context.CancelFunc }

const nativeCompactionTimeout = 5 * time.Minute

func (e *Engine) cmdNativeCompact(agent Agent, native NativeContextCompressor, sessions *SessionManager, key, workspaceDir string, p Platform, msg *Message) {
	session := sessions.GetOrCreateActive(msg.SessionKey)
	if !session.TryLock() {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPreviousProcessing))
		return
	}
	id := session.GetAgentSessionID()
	if id == "" || id == ContinueSession {
		session.UnlockWithoutUpdate()
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCompressNoSession))
		return
	}

	ctx, cancel := context.WithTimeout(e.ctx, nativeCompactionTimeout)
	op := &nativeCompaction{cancel: cancel}
	// Reserve the key before any teardown. /new may select a different Session,
	// but must not permit two native transports on the same conversation key.
	e.interactiveMu.Lock()
	if e.nativeCompactions[key] != nil {
		e.interactiveMu.Unlock()
		cancel()
		session.UnlockWithoutUpdate()
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPreviousProcessing))
		return
	}
	if e.nativeCompactions == nil {
		e.nativeCompactions = make(map[string]*nativeCompaction)
	}
	e.nativeCompactions[key] = op
	e.interactiveMu.Unlock()
	finish := func() {
		cancel()
		e.interactiveMu.Lock()
		if e.nativeCompactions[key] == op {
			delete(e.nativeCompactions, key)
		}
		e.interactiveMu.Unlock()
		session.UnlockWithoutUpdate()
		// Turns queued meanwhile (cron/timer, capacity re-delivery) run now.
		e.drainQueuedAfterNativeCompact(session, sessions, key, agent, workspaceDir)
	}
	if err := e.applyPendingSwitchOnAgent(agent, key, msg.SessionKey); err != nil {
		finish()
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	// Explicit nil closes any idle reader without cancelling our own operation.
	// External /new, /model, /switch and /stop still cancel through normal cleanup.
	e.cleanupInteractiveState(key, nil)
	e.send(p, msg.ReplyCtx, e.i18n.T(MsgCompressing))
	if !e.startMessageWorker(func() {
		defer finish()
		// This session's [projects.session_models] / [projects.session_instructions]
		// entries go in as arguments: writing them onto the shared agent would race
		// a session start on another channel (applySessionModel before StartSession).
		var err error
		if scoped, ok := native.(SessionScopedCompressor); ok {
			err = scoped.CompactSessionWith(ctx, id, e.sessionSettingsFor(msg.SessionKey))
		} else {
			err = native.CompactSession(ctx, id)
		}
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
			}
			return
		}
		session.ResetTurnCtx()
		sessions.Save()
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCompressDone))
	}) {
		finish()
	}
}

func (e *Engine) nativeCompactRunning(key string) bool {
	e.interactiveMu.Lock()
	defer e.interactiveMu.Unlock()
	return e.nativeCompactions[key] != nil
}

// compactDrainRetry is how long drainQueuedAfterNativeCompact waits before
// trying the session lock again. Not from data: a queued cron/timer turn should
// start within about a second of the lock freeing, and each retry is one TryLock.
const compactDrainRetry = time.Second

// drainQueuedAfterNativeCompact starts the turns that queued behind a native
// compaction (enqueueForBusySession accepts them while it runs). The session
// lock was just released; if someone else holds it now, it retries every
// compactDrainRetry until the queue is empty (a turn that took the lock drains
// it itself) or the engine stops, instead of waiting for the next message.
func (e *Engine) drainQueuedAfterNativeCompact(session *Session, sessions *SessionManager, key string, agent Agent, workspaceDir string) {
	e.interactiveMu.Lock()
	state := e.interactiveStates[key]
	e.interactiveMu.Unlock()
	if state == nil {
		return
	}
	state.mu.Lock()
	pending := len(state.pendingMessages)
	state.mu.Unlock()
	if pending == 0 || e.ctx.Err() != nil {
		return
	}
	if !session.TryLock() {
		time.AfterFunc(compactDrainRetry, func() {
			e.drainQueuedAfterNativeCompact(session, sessions, key, agent, workspaceDir)
		})
		return
	}
	if !e.startMessageWorker(func() { e.drainOrphanedQueue(session, sessions, key, agent, workspaceDir) }) {
		session.Unlock()
	}
}
