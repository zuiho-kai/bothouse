package core

import (
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
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

// scheduledTurnCovered reports whether a scheduler (or a restart resume) already waits on a turn
// under iKey with its own time limit (noteScheduledTurn).
func (e *Engine) scheduledTurnCovered(iKey string) bool {
	scheduledTurnsMu.Lock()
	defer scheduledTurnsMu.Unlock()
	for _, k := range e.scheduledTurns {
		if k == iKey {
			return true
		}
	}
	return false
}

// scheduledTurnLimit is the time limit of a cron/timer turn: a timer turn its job's (the 30m
// default when the job is gone), a cron turn its cron job's (the default when the job is gone), a workspace wake-up only its job's own; none for anything else.
func (e *Engine) scheduledTurnLimit(trigger, timerJobID, cronJobID string) time.Duration {
	if trigger == TurnTriggerCron && cronJobID != "" && e.cronScheduler != nil && e.cronScheduler.store != nil {
		if job := e.cronScheduler.store.Get(cronJobID); job != nil {
			return job.ExecutionTimeout()
		}
	}
	return e.turnResumeTimeout(TurnJournalEntry{Trigger: trigger, TimerJobID: timerJobID})
}

var scheduledWatchSeq atomic.Uint64

// armScheduledTurnTimeout runs as every turn starts. A cron/timer turn that no scheduler waits
// on (it queued behind another turn and started after the scheduler moved on, or came back
// after a capacity cooldown) gets its job's time limit here and is stopped when it runs out,
// as StopScheduledTurn stops a direct run. 11-03 caihongmao: her queued outing turns had no
// limit at all. Any turn start replaces the token, so a later turn on the session is never
// stopped by an earlier turn's limit.
// queued: the turn was taken from the queue. A scheduler's registration under iKey belongs to the
// turn it started, and stays until that call returns — which drains the queue first — so it does
// not cover a queued turn (11-04 test: a queued timer turn ran 10 minutes past its 1-minute limit).
func (e *Engine) armScheduledTurnTimeout(state *interactiveState, iKey, trigger, timerJobID, cronJobID, userID string, queued bool) {
	if state == nil {
		return
	}
	state.mu.Lock()
	state.scheduledWatch = 0
	state.mu.Unlock()
	if !scheduledTurnUser(userID) || userID == "heartbeat" || (!queued && e.scheduledTurnCovered(iKey)) {
		return
	}
	limit := e.scheduledTurnLimit(trigger, timerJobID, cronJobID)
	if limit <= 0 {
		return
	}
	tok := scheduledWatchSeq.Add(1)
	state.mu.Lock()
	state.scheduledWatch = tok
	state.mu.Unlock()
	time.AfterFunc(limit, func() {
		state.mu.Lock()
		same := state.scheduledWatch == tok
		state.mu.Unlock()
		if !same {
			return
		}
		if j := e.turnJournalStore(); j != nil && j.Active(iKey) == "" {
			return // the turn already ended
		}
		stopped := e.stopInteractiveSession(iKey, nil, nil)
		slog.Warn("queued scheduled turn timed out; stopping it", "project", e.name, "session", iKey, "trigger", trigger, "timer_job", timerJobID, "cron_job", cronJobID, "limit", limit, "stopped", stopped)
	})
}
