package core

import "net/http"

// handlePublicVersion lets the login page identify the running binary without
// exposing the authenticated status endpoint's projects, adapters or tokens.
func (m *ManagementServer) handlePublicVersion(w http.ResponseWriter, r *http.Request) {
	m.setCORS(w, r)
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]string{"version": CurrentVersion})
}
