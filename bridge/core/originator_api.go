package core

import (
	"encoding/json"
	"net/http"
)

// handleOriginatorSign signs a short-lived ticket naming the platform person whose
// message owns the running turn. The private key never leaves the bridge.
//
// Caller check (originator_caller.go): the request body's project and session are
// environment values the model can set itself, so they authorize nothing. The
// caller must instead descend from a process the bridge started for a turn — the
// peer pid's ancestry is checked for the CC_AGENT/CC_SESSION_KEY the bridge
// injected — and the request must name that process's session (and project, when
// it has one).
func (s *APIServer) handleOriginatorSign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req originatorRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	e, err := s.engineFor(req.Project)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	callerProject, callerSession, known := originatorCallerFn(r)
	if !known {
		http.Error(w, "originator signing is limited to the agent process the bridge started for a turn", http.StatusForbidden)
		return
	}
	if callerProject != "" && callerProject != e.name {
		http.Error(w, "originator signing is limited to the caller's own project", http.StatusForbidden)
		return
	}
	if req.Session != callerSession {
		http.Error(w, "originator signing is limited to the caller's own session", http.StatusForbidden)
		return
	}
	ticket, err := e.signOriginator(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	apiJSON(w, http.StatusOK, ticket)
}
