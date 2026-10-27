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

func (e *Engine) beginResetTurn(key string) {
	e.beginWorkspaceReportTurn(key)
	e.pendingResetMu.Lock()
	if e.resetTurns == nil {
		e.resetTurns = map[string]int{}
	}
	e.resetTurns[key]++
	e.pendingResetMu.Unlock()
}

func (e *Engine) endResetTurn(key string) {
	e.pendingResetMu.Lock()
	if e.resetTurns[key] <= 1 {
		delete(e.resetTurns, key)
	} else {
		e.resetTurns[key]--
	}
	e.pendingResetMu.Unlock()
}

// applyPendingReset runs a queued reset for sessionKey if no turn for that key
// is running and no one holds the session. It reports whether a reset ran. If a
// turn is running, the reset stays queued and runs when that turn ends.
func (e *Engine) applyPendingReset(sessionKey string) bool {
	e.pendingResetMu.Lock()
	pending := e.pendingReset[sessionKey] && e.resetTurns[sessionKey] == 0
	if report := e.workspaceReports[sessionKey]; report != nil && !report.valid {
		pending = false
	}
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
	if !e.pendingReset[sessionKey] || e.resetTurns[sessionKey] != 0 {
		e.pendingResetMu.Unlock()
		return false
	}
	delete(e.pendingReset, sessionKey)
	e.pendingResetMu.Unlock()

	// Messages that queue on the old conversation while it is torn down (the
	// close can take up to ~130s) are kept and handed to the fresh session.
	iKey := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	old := e.interactiveStates[iKey]
	e.interactiveMu.Unlock()
	var agent Agent
	var workspaceDir string
	if old != nil {
		old.mu.Lock()
		old.resetHandoff = true
		agent, workspaceDir = old.agent, old.workspaceDir
		old.mu.Unlock()
	}

	e.startFreshSession(sessions, iKey, sessionKey, "", afterTurnResetReason)
	slog.Info("session reset applied", "session", sessionKey)

	if old != nil {
		old.mu.Lock()
		held := old.pendingMessages
		old.pendingMessages = nil
		old.mu.Unlock()
		e.handOffQueuedAfterReset(sessions, sessionKey, iKey, held, agent, workspaceDir)
	}
	return true
}

// handOffQueuedAfterReset queues held on the fresh session's state and starts
// a turn for them when nothing is running there yet.
func (e *Engine) handOffQueuedAfterReset(sessions *SessionManager, sessionKey, iKey string, held []queuedMessage, agent Agent, workspaceDir string) {
	if len(held) == 0 {
		return
	}
	if agent == nil {
		agent = e.agent
	}
	e.ensureInteractiveStateForQueueing(iKey, held[0].platform, held[0].replyCtx)
	e.interactiveMu.Lock()
	state := e.interactiveStates[iKey]
	state.mu.Lock()
	e.interactiveMu.Unlock()
	state.pendingMessages = append(held, state.pendingMessages...)
	if state.agentSession == nil {
		// A placeholder: drainOrphanedQueue starts a turn with the first
		// message, which adopts and drains the rest.
		state.queuedBehindCompact = true
	}
	state.mu.Unlock()
	slog.Info("session reset: queued messages moved to the fresh session", "session", sessionKey, "count", len(held))

	fresh := sessions.GetOrCreateActive(sessionKey)
	if fresh.TryLock() {
		if !e.startMessageWorker(func() { e.drainOrphanedQueue(fresh, sessions, iKey, agent, workspaceDir) }) {
			fresh.Unlock()
		}
	}
	// Otherwise a turn already runs on the fresh session and drains them.
}
