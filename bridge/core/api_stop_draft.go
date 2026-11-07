package core

import (
	"encoding/json"
	"net/http"
)

// handleStopBlocked: contrib/hooks/run.py reports a reply its Stop hook just
// blocked, so the running turn withdraws that draft instead of sending it and the
// rewrite both (stop_draft.go).
func (s *APIServer) handleStopBlocked(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Project    string `json:"project"`
		SessionKey string `json:"session_key"`
		Draft      string `json:"draft"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	e, err := s.engineFor(req.Project)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	apiJSON(w, http.StatusOK, map[string]any{"ok": true, "noted": e.NoteStopBlocked(req.SessionKey, req.Draft)})
}
