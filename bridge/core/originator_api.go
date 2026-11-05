package core

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
)

// originatorContextRequest is the optional body of POST /originator/context.
// It can only name a project to disambiguate on a bridge serving several; the
// session and the person are never taken from here.
type originatorContextRequest struct {
	Project string `json:"project"`
}

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

// handleOriginatorContext answers "whose turn am I running in", read-only.
//
// It is the companion of /originator/sign for the turns that cannot get a
// ticket: a cron job, a timer, a heartbeat or a workspace wake-up has no human
// message behind it, so signing one would be a lie. Instead the caller asks who
// it is running for, and gets the answer the bridge recorded — the person who
// created the job — with their CURRENT role, so a permission change shows up
// immediately.
//
// The caller check is the same one signing uses and it decides everything: the
// peer's ancestry must reach an agent process the bridge started, and its
// environment names the session. The request body may name a project, but it
// can never name a session or a person; a body that tries is ignored. Callers
// the check does not recognise get 403, exactly like signing.
//
// Nothing secret is returned: no private key, no signature, no credential. The
// fields are what the caller already knows (its own project and session) plus
// the role table's answer about the platform user the bridge has on record.
func (s *APIServer) handleOriginatorContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	// The body is optional and carries at most a project hint for a
	// multi-project bridge. It is read with a small limit so a large body
	// cannot be used to occupy the handler, and a malformed one is refused
	// rather than silently treated as empty.
	var req originatorContextRequest
	if r.Body != nil {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<10))
		if err != nil {
			http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
			return
		}
		if len(bytes.TrimSpace(body)) > 0 {
			if err := json.Unmarshal(body, &req); err != nil {
				http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
				return
			}
		}
	}
	// The caller's own project and session come from the kernel and the
	// bridge-written environment, never from the request.
	callerProject, callerSession, known := originatorCallerFn(r)
	if !known {
		http.Error(w, "user context is limited to the agent process the bridge started for a turn", http.StatusForbidden)
		return
	}
	e, err := s.engineFor(callerProject)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// A body project may only narrow, never widen: it must agree with the
	// caller's own project when the caller has one.
	if req.Project != "" && callerProject != "" && req.Project != callerProject {
		http.Error(w, "user context is limited to the caller's own project", http.StatusForbidden)
		return
	}
	apiJSON(w, http.StatusOK, e.userContextForSession(callerSession))
}
