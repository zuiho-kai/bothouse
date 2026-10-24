package core

// Team mode D: api.sock entry points for the workspace channels (`bothouse workspace …`).

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
)

// teamWorkspaceEngine picks the engine that owns the workspaces: the team lead with
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
	Parent    string          `json:"parent"`
	Workspace TeamWorkspace   `json:"workspace"`
	All       []TeamWorkspace `json:"all"`
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
		http.Error(w, "team workspaces are off (team_workspaces = false on the team lead project, or no lead)", http.StatusServiceUnavailable)
		return
	}
	parent, ws, err := e.NewTeamWorkspace(req.SessionKey)
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
}

func (s *APIServer) handleTeamWorkspaceList(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("session_key")
	if key == "" {
		http.Error(w, "session_key is required", http.StatusBadRequest)
		return
	}
	e := s.teamWorkspaceEngine()
	if e == nil {
		http.Error(w, "team workspaces are off (team_workspaces = false on the team lead project, or no lead)", http.StatusServiceUnavailable)
		return
	}
	parent := teamChatKey(key)
	if p, ok := e.WorkspaceParent(parent); ok {
		parent = p
	}
	res := TeamWorkspaceListResult{Parent: parent, Workspaces: e.TeamWorkspacesOf(parent)}
	if pool, err := e.TeamWorkspacePool(parent); err == nil {
		res.Pool = pool
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	e := s.teamWorkspaceEngine()
	if e == nil {
		http.Error(w, "team workspaces are off (team_workspaces = false on the team lead project, or no lead)", http.StatusServiceUnavailable)
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
	if err := e.ClaimTeamWorkspace(req.SessionKey, req.WorkspaceID, req.Name); err != nil {
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
