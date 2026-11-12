package core

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

// #699 batch D: the task board (board.py) is a client of the task state. Its done / reject /
// wait / pause-without-workspace call this; a pause of a task in a workspace still goes through
// the park (POST /team/workspace/park), which stops the turn and frees the workspace in the same
// commit. The board's own status column is display only.

// TeamTaskTransitionResult is the reply of POST /team/task/transition.
type TeamTaskTransitionResult struct {
	ID    int    `json:"id"`
	Known bool   `json:"known"`           // the bridge has a state record for it
	State string `json:"state,omitempty"` // after the transition (or the current one when unknown/unchanged)
}

// handleTeamTaskTransition: POST /team/task/transition {id, to, by, why}. A task the bridge has no
// record of (never claimed into a workspace) is not an error: 200 with known=false, nothing written.
// 409: the transition does not apply (e.g. paused while it is in a workspace: use the park).
func (s *APIServer) handleTeamTaskTransition(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID  int    `json:"id"`
		To  string `json:"to"`
		By  string `json:"by"`
		Why string `json:"why"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	to := TeamTaskState(req.To)
	switch to {
	case TeamTaskClosed, TeamTaskPaused, TeamTaskReturned, TeamTaskFailed:
	default:
		http.Error(w, "to must be closed, paused, returned or failed (dispatched is a workspace claim)", http.StatusBadRequest)
		return
	}
	e := s.teamWorkspaceEngine()
	if e == nil || e.dataDir == "" {
		http.Error(w, "team workspaces are off", http.StatusServiceUnavailable)
		return
	}
	res := TeamTaskTransitionResult{ID: req.ID}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cur, ok := st.Tasks[req.ID]
	if !ok {
		apiJSON(w, http.StatusOK, res)
		return
	}
	res.Known, res.State = true, string(cur.State)
	if cur.State == to {
		apiJSON(w, http.StatusOK, res) // already there (a repeated done)
		return
	}
	if to == TeamTaskPaused && teamTaskInWork(cur.State) {
		http.Error(w, "task is in a workspace: pause it with the workspace park", http.StatusConflict)
		return
	}
	by := req.By
	if by == "" {
		by = "board"
	}
	t, err := transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: req.ID, To: to, By: by, Why: req.Why}, time.Now())
	if errors.Is(err, ErrTeamTaskTransition) {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	res.State = string(t.State)
	apiJSON(w, http.StatusOK, res)
}
