package core

import (
	"crypto/sha256"
	"fmt"
	"maps"
	"net/http"
	"sort"
	"strings"
)

type activitySession struct {
	Key       string   `json:"key"`
	Name      string   `json:"name"`
	Platform  string   `json:"platform,omitempty"`
	SessionID string   `json:"session_id,omitempty"`
	Members   []string `json:"members,omitempty"`
	Relay     bool     `json:"relay,omitempty"`
}

type activityProject struct {
	Name        string            `json:"name"`
	DisplayName string            `json:"display_name"`
	Sessions    []activitySession `json:"sessions"`
}

type activitySnapshot struct {
	Projects    []activityProject `json:"projects"`
	DSH         dshStatus         `json:"dsh"`
	DSHChannels []activitySession `json:"dsh_channels"`
}

func (m *ManagementServer) handleActivity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	m.mu.RLock()
	engines := maps.Clone(m.engines)
	m.mu.RUnlock()

	st, status := m.readDSHState(r.Context())
	out := activitySnapshot{Projects: []activityProject{}, DSH: status, DSHChannels: []activitySession{}}
	for name, e := range engines {
		if sessions := workingSessions(e); len(sessions) > 0 {
			out.Projects = append(out.Projects, activityProject{Name: name, DisplayName: e.DisplayName(), Sessions: sessions})
		}
	}
	sort.Slice(out.Projects, func(i, j int) bool {
		a, b := out.Projects[i], out.Projects[j]
		if a.DisplayName != b.DisplayName {
			return a.DisplayName < b.DisplayName
		}
		return a.Name < b.Name
	})
	if st != nil {
		out.DSHChannels = dshWorkingChannels(st, engines)
	}
	w.Header().Set("Cache-Control", "no-store")
	mgmtJSON(w, http.StatusOK, out)
}

func workingSessions(e *Engine) []activitySession {
	e.interactiveMu.Lock()
	pool := e.workspacePool
	e.interactiveMu.Unlock()

	// A workspace has its own session IDs. Only the project's primary manager
	// can resolve the IDs used by the management session detail route.
	managers := map[*SessionManager]string{e.sessions: "project"}
	if pool != nil {
		for workspace, ws := range pool.All() {
			ws.mu.Lock()
			manager := ws.sessions
			ws.mu.Unlock()
			if _, exists := managers[manager]; manager != nil && !exists {
				managers[manager] = fmt.Sprintf("%x", sha256.Sum256([]byte(workspace)))
			}
		}
	}

	var rows []activitySession
	for manager, scope := range managers {
		keys, _ := manager.SessionKeyMap()
		for _, session := range manager.AllSessions() {
			session.mu.Lock()
			busy, name := session.busy, session.Name
			session.mu.Unlock()
			if !busy {
				continue
			}
			key := keys[session.ID]
			if name == "" || name == "default" || name == "session" {
				name = ""
				if meta := manager.GetUserMeta(key); meta != nil {
					name = meta.ChatName
					if name == "" {
						name = meta.UserName
					}
				}
			}
			row := activitySession{Key: "turn:" + scope + ":" + session.ID, Name: name}
			if platform, _, ok := strings.Cut(key, ":"); ok {
				row.Platform = platform
			}
			if manager == e.sessions {
				row.SessionID = session.ID
			}
			rows = append(rows, row)
		}
	}
	e.relaySessions.mu.Lock()
	for key := range e.relaySessions.work {
		platform, _, _ := strings.Cut(key, ":")
		rows = append(rows, activitySession{Key: key, Platform: platform, Relay: true})
	}
	e.relaySessions.mu.Unlock()
	sortActivitySessions(rows)
	return rows
}

func dshWorkingChannels(st *dshState, engines map[string]*Engine) []activitySession {
	members := make(map[string]string, len(st.Members))
	for _, member := range st.Members {
		// Bridge bots register their project ID with DSH. Their real turns
		// already appear under the project; DSH's thinking state can precede them.
		if !member.Online || member.ID == "" || member.Kind == "human" || (member.Kind == "bot" && engines[member.ID] != nil) {
			continue
		}
		name := member.Name
		if name == "" {
			name = member.ID
		}
		members[member.ID] = name
	}
	rows := []activitySession{}
	for _, room := range st.Rooms {
		id := room.ID.String()
		row := activitySession{Key: id, Name: room.Name}
		for _, member := range st.Thinking[id] {
			if name, ok := members[member]; ok {
				row.Members = append(row.Members, name)
			}
		}
		if len(row.Members) > 0 {
			sort.Strings(row.Members)
			rows = append(rows, row)
		}
	}
	sortActivitySessions(rows)
	return rows
}

func sortActivitySessions(rows []activitySession) {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Name != rows[j].Name {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Key < rows[j].Key
	})
}
