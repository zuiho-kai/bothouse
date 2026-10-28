package core

// Team mode D: api.sock entry points for the workspace channels (`bothouse workspace …`).

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"
)

// teamWorkspaceEngine picks the engine that owns the workspaces: the current primary role
// (lead.json, isTeamLead), so claims, park, the watch, auto-return and the task board follow a
// lead switch instead of staying on the project that was lead when the bridge started (user
// 2026-10-28: 橘 cooling, lead switched to 鲸鱼娘, `workspace claim` still refused because the
// first project by name with team_workspaces kept the workspaces). team_workspaces is a team
// setting: when the current lead's project has it off but the startup lead had it on, the
// current lead takes the workspaces over. With no current lead in this bridge the old rule
// stays (the first project by name with team_workspaces on).
func (s *APIServer) teamWorkspaceEngine() *Engine {
	s.mu.RLock()
	names := make([]string, 0, len(s.engines))
	for n := range s.engines {
		names = append(names, n)
	}
	sort.Strings(names)
	var lead, first *Engine
	for _, n := range names {
		e := s.engines[n]
		if first == nil && e.teamWS != nil {
			first = e
		}
		if lead == nil && e.team != nil && e.isTeamLead() {
			lead = e
		}
	}
	s.mu.RUnlock()
	if lead == nil || lead == first {
		return first
	}
	if lead.teamWS == nil && lead.teamWorkspacesOn() {
		lead.ensureTeamWS()
	}
	if lead.teamWS == nil {
		return first
	}
	return lead
}

// followLead re-applies the lead-only services (task board, workspaces, handoff watch) when
// lead.json names another primary role. Before this they were set once at start (and on a
// channel host's lead update), so a lead switched through lead.json left the board and the
// workspaces on the old lead until restart.
func (s *APIServer) followLead(seen map[string]bool) {
	s.mu.RLock()
	engines := make([]*Engine, 0, len(s.engines))
	for _, e := range s.engines {
		engines = append(engines, e)
	}
	s.mu.RUnlock()
	changed := false
	for _, e := range engines {
		t := e.team
		if t == nil {
			continue
		}
		lead := e.isTeamLead()
		was, ok := seen[e.name]
		seen[e.name] = lead
		if !ok || was == lead {
			continue
		}
		changed = true
		t.mu.Lock()
		board, ws := t.boardEnabled, t.workspacesEnabled
		t.mu.Unlock()
		e.SetTeamBoard(board)
		e.SetTeamWorkspaces(ws)
		slog.Info("team: primary role changed; lead-only services re-applied", "project", e.name, "lead", lead)
	}
	if changed {
		s.rewatchIfServing()
	}
}

func (s *APIServer) runLeadFollow(stop <-chan struct{}) {
	seen := map[string]bool{}
	tick := time.NewTicker(teamPollInterval)
	defer tick.Stop()
	for {
		s.followLead(seen)
		select {
		case <-stop:
			return
		case <-tick.C:
		}
	}
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
		http.Error(w, "team workspaces are off (team_workspaces = false on the primary role project, or no primary role)", http.StatusServiceUnavailable)
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
