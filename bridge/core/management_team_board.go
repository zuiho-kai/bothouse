package core

import (
	"net/http"
	"sort"
	"strings"
)

// handleTeamBoard: GET /api/v1/team/board lists the open items of the team task board (board.jsonl):
// the desktop pet's 「待办事项」 menu reads it (bridge/cmd/cc-connect/pet_api.go). Finished and
// backlog items are left out, same as the board the leads see.
func (m *ManagementServer) handleTeamBoard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	dir := ""
	m.mu.RLock()
	names := make([]string, 0, len(m.engines))
	for name := range m.engines {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if e := m.engines[name]; e != nil && e.team != nil && e.team.dir != "" {
			dir = e.team.dir
			break
		}
	}
	m.mu.RUnlock()
	type item struct {
		ID     int    `json:"id"`
		Name   string `json:"name"`
		Status string `json:"status"`
		Who    string `json:"who"`
		Paused bool   `json:"paused"`
	}
	items := []item{}
	if dir != "" {
		for _, it := range readTeamTaskBoard(dir) {
			if it.Backlog != "" || it.statusClosed() {
				continue
			}
			name := strings.TrimSpace(it.Short)
			if name == "" {
				name = strings.TrimSpace(it.What)
			}
			items = append(items, item{ID: it.ID, Name: name, Status: strings.TrimSpace(it.Status), Who: it.Who, Paused: it.Paused != ""})
		}
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"team": dir != "", "items": items})
}
