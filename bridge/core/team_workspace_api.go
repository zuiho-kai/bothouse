package core

// Team mode D: api.sock entry points for the workspace channels (`bothouse workspace …`).

import (
	"encoding/json"
	"net/http"
	"sort"
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
	apiJSON(w, http.StatusOK, TeamWorkspaceListResult{Parent: parent, Workspaces: e.TeamWorkspacesOf(parent)})
}
