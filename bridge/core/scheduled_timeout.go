package core

import (
	"log/slog"
	"sync"
)

// scheduledTurns maps a running scheduled turn (cron job, timer job, heartbeat) to the
// interactive key its agent turn runs under, so a scheduler that gives up waiting can stop
// that turn. Before, "job timed out after 30m" only recorded the error: the agent kept running
// and held the session busy (11-03: one cron turn ran 09:00–19:49 and filled the queue).
var scheduledTurnsMu sync.Mutex

func (e *Engine) noteScheduledTurn(runID, iKey string) {
	scheduledTurnsMu.Lock()
	if e.scheduledTurns == nil {
		e.scheduledTurns = map[string]string{}
	}
	e.scheduledTurns[runID] = iKey
	scheduledTurnsMu.Unlock()
}

func (e *Engine) forgetScheduledTurn(runID, iKey string) {
	scheduledTurnsMu.Lock()
	if e.scheduledTurns[runID] == iKey {
		delete(e.scheduledTurns, runID)
	}
	scheduledTurnsMu.Unlock()
}

// StopScheduledTurn stops the agent turn a timed-out scheduled run started, the same way
// /stop does. A run that only queued behind another turn registered nothing, so a user's own
// turn is never stopped here. Returns whether a turn was stopped.
func (e *Engine) StopScheduledTurn(runID string) bool {
	scheduledTurnsMu.Lock()
	iKey, ok := e.scheduledTurns[runID]
	delete(e.scheduledTurns, runID)
	scheduledTurnsMu.Unlock()
	if !ok || iKey == "" {
		return false
	}
	stopped := e.stopInteractiveSession(iKey, nil, nil)
	slog.Warn("scheduled turn timed out; stopping it", "project", e.name, "run", runID, "session", iKey, "stopped", stopped)
	return stopped
}

func heartbeatRunID(sessionKey string) string { return "heartbeat:" + sessionKey }
