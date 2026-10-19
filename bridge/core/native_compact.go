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

func (e *Engine) cmdNativeCompact(agent Agent, native NativeContextCompressor, sessions *SessionManager, key string, p Platform, msg *Message) {
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
		err := native.CompactSession(ctx, id)
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
