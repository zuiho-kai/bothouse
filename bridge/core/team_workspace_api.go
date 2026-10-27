package core

// Team mode D: api.sock entry points for the workspace channels (`bothouse workspace …`).

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
)

// teamWorkspaceEngine picks the engine that owns the workspaces: the primary role with
// team_workspaces on. A working role (any project) may ask; the lead's bot creates.
func (s *APIServer) teamWorkspaceEngine() *Engine {
	s.mu.RLock()
	defer s.mu.RUnlock()
	names := make([]string, 0, len(s.engines))
	for n := range s.engines {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		if e := s.engines[n]; e.teamWS != nil {
			return e
		}
	}
	return nil
}

// TeamWorkspaceNewResult is the reply of POST /team/workspace/new.
type TeamWorkspaceNewResult struct {
	Parent    string              `json:"parent"`
	Workspace TeamWorkspace       `json:"workspace"`
	All       []TeamWorkspace     `json:"all"`
	Queued    bool                `json:"queued,omitempty"`
	Queue     *TeamWorkspaceQueue `json:"queue,omitempty"`
	Message   string              `json:"message,omitempty"`
}

func (s *APIServer) handleTeamWorkspaceNew(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		SessionKey string `json:"session_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.SessionKey == "" {
		http.Error(w, "session_key is required (the chat or workspace channel)", http.StatusBadRequest)
		return
	}
	e := s.teamWorkspaceEngine()
	if e == nil {
		http.Error(w, "team workspaces are off (team_workspaces = false on the primary role project, or no primary role)", http.StatusServiceUnavailable)
		return
	}
	parent, ws, err := e.NewTeamWorkspace(req.SessionKey)
	var queued *TeamWorkspaceQueued
	if errors.As(err, &queued) {
		message := e.i18n.T(MsgWorkspaceQueued)
		if queued.Queue != nil {
			if queued.Queue.Position > 0 {
				message += e.i18n.Tf(MsgWorkspaceQueuePosition, queued.Queue.Position)
			}
			if queued.Queue.Reason != "" {
				message += ": " + queued.Queue.Reason
			}
		}
		apiJSON(w, http.StatusOK, TeamWorkspaceNewResult{Parent: parent, Queued: true, Queue: queued.Queue, Message: message, All: e.TeamWorkspacesOf(parent)})
		return
	}
	if errors.Is(err, ErrTeamWorkspaceNotLeadChat) {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if errors.Is(err, ErrTeamWorkspaceBusy) {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	apiJSON(w, http.StatusOK, TeamWorkspaceNewResult{Parent: parent, Workspace: ws, All: e.TeamWorkspacesOf(parent)})
}

// TeamWorkspaceListResult is the reply of GET /team/workspace/list.
type TeamWorkspaceListResult struct {
	Parent     string          `json:"parent"`
	Workspaces []TeamWorkspace `json:"workspaces"`
	// Pool: every 「工作区n」 of the server/category, lowest first (shared by all chat channels),
	// each with its owner ("" = free).
	Pool []TeamWorkspace `json:"pool,omitempty"`
	// WatchDue: when session_key is a workspace, the earliest check time of the bridge's
	// ten-minute watch on its tasks in work (zero: not watched; the lead's d10 scripts skip a
	// watched workspace).
	WatchDue time.Time `json:"watch_due,omitzero"`
	// Hint: what to do next when the chat channel has no workspace at all (none of its own and
	// none in the pool) — workspaces are only made on request, so say how (#587).
	Hint string `json:"hint,omitempty"`
}

func (s *APIServer) handleTeamWorkspaceList(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("session_key")
	if key == "" {
		http.Error(w, "session_key is required", http.StatusBadRequest)
		return
	}
	e := s.teamWorkspaceEngine()
	if e == nil {
		http.Error(w, "team workspaces are off (team_workspaces = false on the primary role project, or no primary role)", http.StatusServiceUnavailable)
		return
	}
	parent := teamChatKey(key)
	if p, ok := e.WorkspaceParent(parent); ok {
		parent = p
	}
	res := TeamWorkspaceListResult{Parent: parent, Workspaces: e.TeamWorkspacesOf(parent), WatchDue: e.teamWorkspaceWatchDue(key)}
	pool, err := e.TeamWorkspacePool(parent)
	if err == nil {
		res.Pool = pool
	}
	if len(res.Workspaces) == 0 && err == nil && len(pool) == 0 {
		res.Hint = teamWorkspaceNoneHint
	}
	apiJSON(w, http.StatusOK, res)
}

// handleTeamWorkspaceClaim records the chat channel handing off to a pool workspace as its
// owner, so its asks and reports return there. A workspace another chat channel owns is
// refused with 409 (ErrTeamWorkspaceOwned): pick a free one from the pool or create the next.
func (s *APIServer) handleTeamWorkspaceClaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		SessionKey  string `json:"session_key"`
		WorkspaceID string `json:"workspace_id"`
		Name        string `json:"name"`
		// Owner (optional): who the task goes to, mentioned by the ten-minute watch's nudge.
		// Title (optional): the task's short name for the nudge.
		Owner string `json:"owner"`
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	e := s.teamWorkspaceEngine()
	if e == nil {
		http.Error(w, "team workspaces are off (team_workspaces = false on the primary role project, or no primary role)", http.StatusServiceUnavailable)
		return
	}
	if req.Name == "" {
		if pool, err := e.TeamWorkspacePool(req.SessionKey); err == nil {
			for _, x := range pool {
				if x.ID == req.WorkspaceID {
					req.Name = x.Name
				}
			}
		}
	}
	if err := e.ClaimTeamWorkspaceFor(req.SessionKey, req.WorkspaceID, req.Name, req.Owner, req.Title); err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, ErrTeamWorkspaceOwned) {
			code = http.StatusConflict
		}
		http.Error(w, err.Error(), code)
		return
	}
	plat, _, _ := strings.Cut(teamChatKey(req.SessionKey), ":")
	parent, _ := e.WorkspaceParent(plat + ":" + req.WorkspaceID)
	apiJSON(w, http.StatusOK, TeamWorkspaceListResult{Parent: parent, Workspaces: e.TeamWorkspacesOf(parent)})
}

// TeamWorkspaceParkResult is the reply of POST /team/workspace/park.
type TeamWorkspaceParkResult struct {
	Workspace string `json:"workspace"` // "<platform>:<workspace id>"
	// Freed: no other task is in work there, so the workspace went back to the pool (on
	// cloud_web/DSH once the gateway agrees) and its sessions were reset. False: other tasks
	// keep it; only this one is paused.
	Freed bool `json:"freed"`
}

// handleTeamWorkspacePark pauses one task of a workspace (ParkTeamWorkspace): workspace_id
// names it on the platform of session_key; without workspace_id, session_key is the workspace.
// When it was the last task in work there, the workspace goes back to the pool and the
// sessions of every role in it are reset. 404 when no chat channel owns the workspace.
func (s *APIServer) handleTeamWorkspacePark(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		SessionKey  string `json:"session_key"`
		WorkspaceID string `json:"workspace_id"`
		// Chat: the chat channel that handed the task off (the board pausing it); it must own the
		// workspace now, and only its handoff is parked. Before (RFC 3339): when the board bound
		// the task; the newest handoff of chat at or before it is the one parked.
		Chat   string `json:"chat"`
		Before string `json:"before"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.SessionKey == "" {
		http.Error(w, "session_key is required (the chat or workspace channel)", http.StatusBadRequest)
		return
	}
	var before time.Time
	if req.Before != "" {
		t, err := time.Parse(time.RFC3339Nano, req.Before)
		if err != nil {
			http.Error(w, "before must be RFC 3339: "+err.Error(), http.StatusBadRequest)
			return
		}
		before = t
	}
	e := s.teamWorkspaceEngine()
	if e == nil {
		http.Error(w, "team workspaces are off (team_workspaces = false on the primary role project, or no primary role)", http.StatusServiceUnavailable)
		return
	}
	key := teamChatKey(req.SessionKey)
	if req.WorkspaceID != "" {
		plat, _, _ := strings.Cut(key, ":")
		key = plat + ":" + req.WorkspaceID
	}
	freed, err := s.parkAndReset(e, key, req.Chat, before)
	if errors.Is(err, ErrTeamWorkspaceNotOwned) {
		msg := err.Error()
		parent := key
		if p, ok := e.WorkspaceParent(key); ok {
			parent = p
		}
		if req.Chat != "" {
			parent = teamChatKey(req.Chat)
		}
		if len(e.TeamWorkspacesOf(parent)) == 0 {
			msg += "; " + teamWorkspaceNoneHint
		}
		http.Error(w, msg, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	apiJSON(w, http.StatusOK, TeamWorkspaceParkResult{Workspace: key, Freed: freed})
}

// parkAndReset parks a task of workspace key on the team workspace engine e
// (ParkTeamWorkspaceFor) and, when that freed the workspace, also resets the teammates'
// sessions there (e reset the lead's). Shared by the park API and the ten-minute watch.
func (s *APIServer) parkAndReset(e *Engine, key, chat string, before time.Time) (bool, error) {
	freed, err := e.ParkTeamWorkspaceFor(key, chat, before)
	if err != nil || !freed {
		return freed, err
	}
	s.mu.RLock()
	others := make([]*Engine, 0, len(s.engines))
	for _, x := range s.engines {
		if x != e {
			others = append(others, x)
		}
	}
	s.mu.RUnlock()
	for _, x := range others {
		x.ResetTeamWorkspaceSessions(key)
	}
	return true, nil
}
