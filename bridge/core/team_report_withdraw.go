package core

import (
	"fmt"
	"log/slog"
)

// tellAcceptTurnWithdrawn reaches the lead's acceptance turn of a held report that was just
// withdrawn (dropHeldReport). Before, only the record changed: the turn the lead had been woken
// with kept checking a report nobody could accept any more. #1570 (agentm 2026-11-13): #91 was
// handed over at 15:15, its held report withdrawn at 15:23, and 鲸鱼娘's acceptance turn went on
// re-reading the board, sessions and auth until 15:28. The turn is told why and to stop, inside
// the turn when the agent takes mid-turn input, otherwise it is cancelled like /stop.
func (e *Engine) tellAcceptTurnWithdrawn(jobID string, board int, why string) {
	if jobID == "" {
		return
	}
	iKey := e.interactiveKeyRunningJob(jobID)
	if iKey == "" {
		return // the acceptance turn already ended, or has not started (it then sees the verdict)
	}
	note := fmt.Sprintf("【系统】#%d 的汇报已撤销，不用再验收：%s。这件不要再查任务板、会话或授权，这一轮直接收手。", board, why)
	if e.canInjectInto(e.agent, iKey) && e.injectIntoRunningTurn(iKey, note, nil, nil, nil) {
		slog.Info("report accept: withdrawn; told the running acceptance turn", "board_item", board, "session", iKey)
		return
	}
	stopped := e.stopInteractiveSession(iKey, nil, nil)
	slog.Info("report accept: withdrawn; stopped the running acceptance turn", "board_item", board, "session", iKey, "stopped", stopped)
}

// interactiveKeyRunningJob returns the interactive key whose running turn is timer job jobID.
func (e *Engine) interactiveKeyRunningJob(jobID string) string {
	type entry struct {
		key string
		st  *interactiveState
	}
	e.interactiveMu.Lock()
	states := make([]entry, 0, len(e.interactiveStates))
	for k, st := range e.interactiveStates {
		if st != nil {
			states = append(states, entry{k, st})
		}
	}
	e.interactiveMu.Unlock()
	for _, it := range states {
		it.st.mu.Lock()
		hit := it.st.currentJobID == jobID
		it.st.mu.Unlock()
		if hit {
			return it.key
		}
	}
	return ""
}
