package core

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
)

func (s *APIServer) handlePublicProgress(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req PublicProgressRequest
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	d.DisallowUnknownFields()
	if err := d.Decode(&req); err != nil {
		inputHTTPError(w, 400, errors.New("invalid progress request"))
		return
	}
	if err := d.Decode(new(any)); err != io.EOF {
		inputHTTPError(w, 400, errors.New("expected one request"))
		return
	}
	if err := req.Validate(); err != nil {
		inputHTTPError(w, 400, err)
		return
	}
	s.mu.RLock()
	e := s.engines[req.Project]
	s.mu.RUnlock()
	if e == nil || e.publicProgress == nil || e.ctx.Err() != nil {
		inputHTTPError(w, 409, errors.New("public progress unavailable"))
		return
	}
	id, err := e.publicProgress.Report(req)
	if err != nil {
		inputHTTPError(w, 409, err)
		return
	}
	apiJSON(w, 200, map[string]string{"task_id": id, "status": "recorded"})
}

// progressFor resolves the project engine that owns public progress state.
func (s *APIServer) progressFor(project string) *PublicProgress {
	s.mu.RLock()
	e := s.engines[project]
	s.mu.RUnlock()
	if e == nil || e.publicProgress == nil || e.ctx.Err() != nil {
		return nil
	}
	return e.publicProgress
}

// handleTask serves the read side of the task cards: one task by id, or the
// recent list for a session. It exposes only deliberately public summaries.
func (s *APIServer) handleTask(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	progress := s.progressFor(q.Get("project"))
	if progress == nil {
		inputHTTPError(w, 409, errors.New("public progress unavailable"))
		return
	}
	if id := q.Get("id"); id != "" {
		task, ok := progress.Task(id)
		if !ok {
			inputHTTPError(w, 404, errors.New("unknown task"))
			return
		}
		apiJSON(w, 200, map[string]any{"task": task})
		return
	}
	limit := defaultTaskListLimit
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 64 {
			inputHTTPError(w, 400, errors.New("limit must be 1..64"))
			return
		}
		limit = n
	}
	apiJSON(w, 200, map[string]any{"tasks": progress.Tasks(q.Get("session"), limit)})
}

// handleTaskAccept records the human's acceptance of a delivered result.
func (s *APIServer) handleTaskAccept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Project string `json:"project"`
		TaskID  string `json:"task_id"`
		Actor   string `json:"actor"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if err := d.Decode(&req); err != nil {
		inputHTTPError(w, 400, errors.New("invalid acceptance request"))
		return
	}
	if err := d.Decode(new(any)); err != io.EOF {
		inputHTTPError(w, 400, errors.New("expected one request"))
		return
	}
	if req.TaskID == "" {
		inputHTTPError(w, 400, errors.New("task_id required"))
		return
	}
	progress := s.progressFor(req.Project)
	if progress == nil {
		inputHTTPError(w, 409, errors.New("public progress unavailable"))
		return
	}
	task, err := progress.Accept(req.TaskID, req.Actor)
	if err != nil {
		inputHTTPError(w, 409, err)
		return
	}
	apiJSON(w, 200, map[string]any{"task": task, "status": "accepted"})
}
