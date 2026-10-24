package core

import (
	"fmt"
	"log/slog"
)

// `cc-connect session new --after-turn`: an agent asks the bridge to give its
// own session a fresh context once the current turn has replied. The effect is
// the same as the user typing /new (startFreshSession), minus the chat notice.

// SessionResetResult tells the agent whether the reset ran now or is queued.
type SessionResetResult struct {
	OK      bool   `json:"ok"`
	Queued  bool   `json:"queued"` // true: runs after the current turn's reply
	Message string `json:"message"`
}

const afterTurnResetReason = "上一轮结束后由 session new --after-turn 新开"

// QueueSessionReset resets sessionKey's conversation after its running turn,
// or immediately when no turn is running. sessionKey is the caller's
// CC_SESSION_KEY; an unknown key is an error so a typo cannot reset nothing
// (or someone else) silently.
func (e *Engine) QueueSessionReset(sessionKey string) (SessionResetResult, error) {
	if sessionKey == "" {
		return SessionResetResult{}, fmt.Errorf("session_key is required (CC_SESSION_KEY)")
	}
	_, sessions := e.sessionContextForKey(sessionKey)
	if sessions == nil || sessions.ActiveSessionID(sessionKey) == "" {
		return SessionResetResult{}, fmt.Errorf("session %q not found in project %q", sessionKey, e.name)
	}
	e.pendingResetMu.Lock()
	if e.pendingReset == nil {
		e.pendingReset = map[string]bool{}
	}
	e.pendingReset[sessionKey] = true
	e.pendingResetMu.Unlock()
	slog.Info("session reset queued", "session", sessionKey)

	// No turn running: reset now. A turn that is running applies it when it
	// ends (processInteractiveMessageWith); queueing first closes the race
	// with a turn that ends between the check and the queue.
	if e.applyPendingReset(sessionKey) {
		return SessionResetResult{OK: true, Message: "no turn running: the session was reset now; the next message starts a fresh context"}, nil
	}
	return SessionResetResult{OK: true, Queued: true, Message: "queued: the session is reset after this turn's reply is delivered; the next message starts a fresh context"}, nil
}

// applyPendingReset runs a queued reset for sessionKey if no turn holds the
// session. It reports whether a reset ran. If a new turn already took the
// session, the reset stays queued and runs when that turn ends.
func (e *Engine) applyPendingReset(sessionKey string) bool {
	e.pendingResetMu.Lock()
	pending := e.pendingReset[sessionKey]
	e.pendingResetMu.Unlock()
	if !pending {
		return false
	}
	_, sessions := e.sessionContextForKey(sessionKey)
	if sessions == nil {
		return false
	}
	session := sessions.GetOrCreateActive(sessionKey)
	if !session.TryLock() {
		return false
	}
	defer session.UnlockWithoutUpdate()
	e.pendingResetMu.Lock()
	if !e.pendingReset[sessionKey] {
		e.pendingResetMu.Unlock()
		return false
	}
	delete(e.pendingReset, sessionKey)
	e.pendingResetMu.Unlock()

	e.startFreshSession(sessions, e.interactiveKeyForSessionKey(sessionKey), sessionKey, "", afterTurnResetReason)
	slog.Info("session reset applied", "session", sessionKey)
	return true
}
