package core

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
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
