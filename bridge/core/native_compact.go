package core

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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
	e.startNativeCompact(agent, native, session, sessions, key, msg.SessionKey, workspaceDir, p, msg.ReplyCtx, e.i18n.T(MsgCompressing), false)
}

// startNativeCompact runs a native compaction on session, which the caller has
// locked; it takes over that lock. notice is the "compressing" message sent
// before it starts. auto (the [projects.auto_compress] trigger) keeps the chat
// quiet apart from notice, like runCompress(auto=true): problems are logged,
// and no completion message is sent.
func (e *Engine) startNativeCompact(agent Agent, native NativeContextCompressor, session *Session, sessions *SessionManager, key, sessionKey, workspaceDir string, p Platform, replyCtx any, notice string, auto bool) {
	reply := func(content string) {
		if auto {
			slog.Warn("auto-compress (native) failed", "session", sessionKey, "reason", content)
			return
		}
		e.reply(p, replyCtx, content)
	}
	id := session.GetAgentSessionID()
	if id == "" || id == ContinueSession {
		session.UnlockWithoutUpdate()
		reply(e.i18n.T(MsgCompressNoSession))
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
		reply(e.i18n.T(MsgPreviousProcessing))
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
	if err := e.applyPendingSwitchOnAgent(agent, key, sessionKey); err != nil {
		finish()
		reply(e.i18n.Tf(MsgError, err))
		return
	}
	// Explicit nil closes any idle reader without cancelling our own operation.
	// External /new, /model, /switch and /stop still cancel through normal cleanup.
	e.cleanupInteractiveState(key, nil)
	e.send(p, replyCtx, notice)
	if !e.startMessageWorker(func() {
		defer finish()
		// This session's [projects.session_models] / [projects.session_instructions]
		// entries go in as arguments: writing them onto the shared agent would race
		// a session start on another channel (applySessionModel before StartSession).
		var err error
		if scoped, ok := native.(SessionScopedCompressor); ok {
			err = scoped.CompactSessionWith(ctx, id, e.sessionSettingsFor(sessionKey))
		} else {
			err = native.CompactSession(ctx, id)
		}
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				reply(e.i18n.Tf(MsgError, err))
			}
			return
		}
		session.ResetTurnCtx()
		sessions.Save()
		if auto {
			slog.Info("auto-compress (native): done", "session", sessionKey)
			return
		}
		e.reply(p, replyCtx, e.i18n.T(MsgCompressDone))
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

// applyPendingAutoCompact runs the native compaction that the
// [projects.auto_compress] check queued on iKey's state (autoCompactDue) at the
// end of a turn. It is called after that turn, and the turns queued behind it,
// released the session, so it never interrupts a running turn. If someone holds
// the session again, it is skipped: the next turn's end checks the threshold anew.
func (e *Engine) applyPendingAutoCompact(iKey, sessionKey string, sessions *SessionManager, agent Agent, workspaceDir string) {
	e.interactiveMu.Lock()
	state := e.interactiveStates[iKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return
	}
	state.mu.Lock()
	due := state.autoCompactDue
	state.autoCompactDue = false
	tokens := state.lastAutoCompressTokens
	p, replyCtx := state.platform, state.replyCtx
	if state.agent != nil {
		agent = state.agent
	}
	state.mu.Unlock()
	if !due || p == nil {
		return
	}
	if agent == nil {
		agent = e.agent
	}
	native, ok := agent.(NativeContextCompressor)
	if !ok {
		return
	}
	// The compaction tears the interactive state down (cleanupInteractiveState),
	// so its lastAutoCompressAt is lost; min_gap_mins is kept per key here.
	now := time.Now()
	e.interactiveMu.Lock()
	last := e.nativeAutoCompactAt[iKey]
	e.interactiveMu.Unlock()
	if !last.IsZero() && now.Sub(last) < e.autoCompressMinGap {
		return
	}
	session := sessions.GetOrCreateActive(sessionKey)
	if !session.TryLock() {
		return
	}
	e.interactiveMu.Lock()
	if e.nativeAutoCompactAt == nil {
		e.nativeAutoCompactAt = make(map[string]time.Time)
	}
	e.nativeAutoCompactAt[iKey] = now
	e.interactiveMu.Unlock()
	slog.Info("auto-compress (native): triggering", "session", sessionKey)
	notice := e.i18n.T(MsgCompressing)
	if tokens > 0 {
		notice = fmt.Sprintf("%s (~%dk tokens)", notice, tokens/1000)
	}
	e.startNativeCompact(agent, native, session, sessions, iKey, sessionKey, workspaceDir, p, replyCtx, notice, true)
}
