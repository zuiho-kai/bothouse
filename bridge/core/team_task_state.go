package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// #699: one state record per task, written only by explicit events (a claim with the task's
// board id, a park), never inferred from reply text or timers. Before this, "which step is
// task N at" lived in four records that did not agree (team_workspaces.json handoffs, board.jsonl,
// the report queue, the live sessions), and the watch found "the board row of this workspace"
// by matching the workspace and a number in the title (handoffBoardID). On 11-11 that wrote
// #679's renewals onto #677's row after #677 was paused (watch parks marked only the handoff,
// never the row), and the paused #677 kept running because the watch parked with stop=false.
// Design: notes/task-state-refactor-design-20261111.md §3.
//
// This file is the store and the one transition function. Batch 1 (this PR) wires the claim
// (→ dispatched), the first progress seen (→ working) and every park (→ paused). Returned,
// asking, failed and closed are wired by later batches (explicit report/ask commands, board.py
// through the bridge API).

// TeamTaskState is where one task is in its life cycle.
type TeamTaskState string

const (
	TeamTaskDispatched TeamTaskState = "dispatched" // handed to a workspace, no progress seen yet
	TeamTaskWorking    TeamTaskState = "working"    // the workspace is working on it
	TeamTaskAsking     TeamTaskState = "asking"     // asked the user; the workspace was given back
	TeamTaskPaused     TeamTaskState = "paused"     // stopped (user, watch, waiting); not in a workspace
	TeamTaskFailed     TeamTaskState = "failed"     // handed back as failed
	TeamTaskReturned   TeamTaskState = "returned"   // handed back, waiting for acceptance
	TeamTaskClosed     TeamTaskState = "closed"     // accepted / done / dropped
)

// teamTaskInWork: the task holds its workspace in this state.
func teamTaskInWork(s TeamTaskState) bool { return s == TeamTaskDispatched || s == TeamTaskWorking }

// TeamTask is the state record of one task, keyed by its task-board id.
type TeamTask struct {
	ID    int           `json:"id"`
	State TeamTaskState `json:"state"`
	WS    string        `json:"ws,omitempty"`   // "<platform>:<workspace id>" while dispatched/working
	Chat  string        `json:"chat,omitempty"` // chat channel that handed it off
	Since time.Time     `json:"since"`          // when it entered State
	By    string        `json:"by,omitempty"`   // what moved it (claim, watch, board, …)
	Why   string        `json:"why,omitempty"`  // reason of a pause/failure
}

// teamTaskEvent is one transition request.
type teamTaskEvent struct {
	ID   int
	To   TeamTaskState
	WS   string // dispatched: the workspace it goes to
	Chat string
	By   string
	Why  string
}

// teamTaskAllowed: from → the states it may move to. A task the store has never seen starts at
// dispatched. Re-dispatching is allowed from any state but closed: a resume, a rejected report
// and an answered ask all hand the task to a workspace again.
var teamTaskAllowed = map[TeamTaskState][]TeamTaskState{
	"":                 {TeamTaskDispatched},
	TeamTaskDispatched: {TeamTaskDispatched, TeamTaskWorking, TeamTaskPaused, TeamTaskAsking, TeamTaskReturned, TeamTaskFailed, TeamTaskClosed},
	TeamTaskWorking:    {TeamTaskDispatched, TeamTaskPaused, TeamTaskAsking, TeamTaskReturned, TeamTaskFailed, TeamTaskClosed},
	TeamTaskAsking:     {TeamTaskDispatched, TeamTaskPaused, TeamTaskClosed},
	TeamTaskPaused:     {TeamTaskDispatched, TeamTaskClosed},
	TeamTaskFailed:     {TeamTaskDispatched, TeamTaskPaused, TeamTaskClosed},
	TeamTaskReturned:   {TeamTaskDispatched, TeamTaskClosed},
	TeamTaskClosed:     {},
}

// ErrTeamTaskTransition: the event does not apply to the task's current state.
var ErrTeamTaskTransition = fmt.Errorf("team task: transition not allowed")

const teamTaskLogFile = "team_task_events.jsonl"

// The task records live in team_workspaces.json (teamWorkspaceState.Tasks), next to the handoffs
// and workspace ownership they move with: a claim (dispatched + handoff + owner) and a park
// (paused + Parked mark + release) are one atomic write of that file, so no failure and no crash
// can leave one changed without the other (#715 review of #1632: two files written in turn had no
// common commit point). Reading that file is strict (loadTeamWorkspacesLocked): only a missing
// file is empty, an unreadable or unparsable one is an error and is never written over.

// teamTasksOfLocked returns the task records of st, creating the map on first use.
func teamTasksOfLocked(st *teamWorkspaceState) map[int]TeamTask {
	if st.Tasks == nil {
		st.Tasks = map[int]TeamTask{}
	}
	return st.Tasks
}

// planTeamTaskTransition applies ev to tasks in memory (nothing written) and returns the record
// before and after. ErrTeamTaskTransition when ev does not apply to the current state.
func planTeamTaskTransition(tasks map[int]TeamTask, ev teamTaskEvent, now time.Time) (cur, next TeamTask, err error) {
	if ev.ID <= 0 {
		return cur, cur, fmt.Errorf("team task: a board id is required")
	}
	cur = tasks[ev.ID]
	ok := false
	for _, s := range teamTaskAllowed[cur.State] {
		if s == ev.To {
			ok = true
			break
		}
	}
	if !ok {
		return cur, cur, fmt.Errorf("team task #%d: %s → %s: %w", ev.ID, cur.State, ev.To, ErrTeamTaskTransition)
	}
	next = cur
	next.ID, next.State, next.Since, next.By, next.Why = ev.ID, ev.To, now, ev.By, ev.Why
	if ev.Chat != "" {
		next.Chat = ev.Chat
	}
	switch {
	case ev.To == TeamTaskDispatched:
		next.WS = teamChatKey(ev.WS)
	case !teamTaskInWork(ev.To):
		next.WS = "" // out of the workspace: it no longer holds one
	}
	tasks[ev.ID] = next
	return cur, next, nil
}

// transitionTeamTaskLocked applies ev with no workspace change (e.g. dispatched → working).
// Caller holds teamWorkspaceStore.mu. On any error nothing is written.
func transitionTeamTaskLocked(dataDir string, ev teamTaskEvent, now time.Time) (TeamTask, error) {
	if dataDir == "" {
		return TeamTask{}, fmt.Errorf("team task: data dir is required")
	}
	path := teamWorkspacePath(dataDir)
	st, err := loadTeamWorkspacesLocked(path)
	if err != nil {
		return TeamTask{}, err
	}
	cur := st.Tasks[ev.ID]
	if err := commitTeamTaskAndWorkspacesLocked(dataDir, path, st, ev, now); err != nil {
		return cur, err
	}
	return st.Tasks[ev.ID], nil
}

// commitTeamTaskAndWorkspacesLocked applies task transition ev to st (whose workspace records the
// caller has already changed in memory: the claim's handoff, the park's Parked mark and release)
// and saves st in one write. Caller holds teamWorkspaceStore.mu. On any failure nothing is
// written and the cached state is put back to the file, so the caller's in-memory changes are
// gone too; the caller returns the error (#1632 review: park warned on a failed transition and
// still freed the workspace). ev.ID 0: no task record, only the workspace records are saved.
// Each applied transition appends one line to the event log after the commit.
func commitTeamTaskAndWorkspacesLocked(dataDir, path string, st *teamWorkspaceState, ev teamTaskEvent, now time.Time) error {
	if ev.ID <= 0 {
		return saveTeamWorkspacesLocked(path, st)
	}
	cur, next, err := planTeamTaskTransition(teamTasksOfLocked(st), ev, now)
	if err != nil {
		teamWorkspaceRollbackLocked(path)
		return err
	}
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		return fmt.Errorf("team task #%d: save: %w", ev.ID, err)
	}
	logTeamTaskTransition(dataDir, cur, next)
	return nil
}

func logTeamTaskTransition(dataDir string, cur, next TeamTask) {
	appendTeamTaskEvent(dataDir, cur, next)
	slog.Info("team task: state changed", "board", next.ID, "from", string(cur.State), "to", string(next.State), "ws", next.WS, "by", next.By, "why", next.Why)
}

// appendTeamTaskEvent keeps the transition history (read by people and tests; the snapshot is
// the source). A failed append is logged, the transition stands.
func appendTeamTaskEvent(dataDir string, from, to TeamTask) {
	line, err := json.Marshal(map[string]any{"at": to.Since, "id": to.ID, "from": from.State, "to": to.State, "ws": to.WS, "by": to.By, "why": to.Why})
	if err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(dataDir, teamTaskLogFile), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		slog.Warn("team task: event log open failed", "error", err)
		return
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		slog.Warn("team task: event log write failed", "error", err)
	}
}

// TeamTask returns the state record of board item id (false: the store has never seen it); an
// unreadable store is an error, not "never seen".
func (e *Engine) TeamTask(id int) (TeamTask, bool, error) {
	if e == nil || e.dataDir == "" || id <= 0 {
		return TeamTask{}, false, nil
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if err != nil {
		return TeamTask{}, false, err
	}
	t, ok := st.Tasks[id]
	return t, ok, nil
}

// teamTaskInWorkOnLocked: whether task id is dispatched/working in workspace key. Caller holds
// teamWorkspaceStore.mu.
func teamTaskInWorkOnLocked(dataDir string, id int, key string) (TeamTask, bool, error) {
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(dataDir))
	if err != nil {
		return TeamTask{}, false, err
	}
	t, ok := st.Tasks[id]
	return t, ok && teamTaskInWork(t.State) && t.WS == teamChatKey(key), nil
}
