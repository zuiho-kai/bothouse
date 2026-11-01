package core

import (
	"encoding/json"
	"io"
	"net/http"
)

func (s *APIServer) handleTaskText(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct{ Project, TaskID, DeliveryID, Action, Evidence string }
	if err := json.NewDecoder(io.LimitReader(r.Body, s.sendBodyLimit())).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	e := s.engines[req.Project]
	s.mu.RUnlock()
	if e == nil || e.publicProgress == nil {
		http.Error(w, "project task journal unavailable", http.StatusNotFound)
		return
	}
	if req.Action != "list" {
		if err := e.publicProgress.ResolveTaskText(req.TaskID, req.DeliveryID, req.Action, req.Evidence); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	d, err := e.publicProgress.TaskTextDeliveries(req.TaskID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	apiJSON(w, http.StatusOK, d)
}
