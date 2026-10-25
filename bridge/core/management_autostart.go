package core

import (
	"encoding/json"
	"net/http"
)

// AutostartInfo is what the settings page shows for "start at login".
// Supervisor: self (the bothouse service runs this process; the switch works),
// external (another service manager entry runs it; managed outside, switch
// disabled), none (not running as a service; switch disabled).
type AutostartInfo struct {
	Supervisor string `json:"supervisor"`
	Enabled    bool   `json:"enabled"`
	Platform   string `json:"platform,omitempty"`
	Label      string `json:"label,omitempty"`
}

// SetAutostartFuncs wires GET/PUT /api/v1/autostart to the daemon package
// (cmd/cc-connect). set must refuse unless Supervisor == self.
func (m *ManagementServer) SetAutostartFuncs(get func() (AutostartInfo, error), set func(bool) (AutostartInfo, error)) {
	m.getAutostart = get
	m.setAutostart = set
}

func (m *ManagementServer) handleAutostart(w http.ResponseWriter, r *http.Request) {
	if m.getAutostart == nil || m.setAutostart == nil {
		mgmtError(w, http.StatusServiceUnavailable, "autostart not available")
		return
	}
	switch r.Method {
	case http.MethodGet:
		st, err := m.getAutostart()
		if err != nil {
			mgmtError(w, http.StatusInternalServerError, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, st)
	case http.MethodPut, http.MethodPost:
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
			mgmtError(w, http.StatusBadRequest, `body must be {"enabled": true|false}`)
			return
		}
		cur, err := m.getAutostart()
		if err != nil {
			mgmtError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if cur.Supervisor != "self" {
			mgmtError(w, http.StatusConflict, "autostart is managed outside bothouse for this process")
			return
		}
		st, err := m.setAutostart(*body.Enabled)
		if err != nil {
			mgmtError(w, http.StatusInternalServerError, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, st)
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET or PUT only")
	}
}
