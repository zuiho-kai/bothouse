package core

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// These controls live only on the existing local Unix API, not on the public
// webhook/management server. Only a trusted local operator can bind a source.
// External webhook events can neither register nor enable their own binding.
type ExternalTaskEventRequest struct {
	Project        string `json:"project"`
	SourceInstance string `json:"source_instance"`
	ThreadRef      string `json:"thread_ref,omitempty"`
	TaskID         string `json:"task_id,omitempty"`
	Enabled        bool   `json:"enabled,omitempty"`
	EventID        string `json:"event_id,omitempty"`
	Assignment     string `json:"assignment,omitempty"`
}

func (s *APIServer) handleTaskEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && r.URL.Path == "/task/events" {
		p := s.progressFor(r.URL.Query().Get("project"))
		if p == nil {
			inputHTTPError(w, 409, errors.New("task input journal unavailable"))
			return
		}
		id := r.URL.Query().Get("task_id")
		if id == "" {
			inputHTTPError(w, 400, errors.New("task_id required"))
			return
		}
		if _, ok := p.Task(id); !ok {
			inputHTTPError(w, 404, errors.New("task not found"))
			return
		}
		source := r.URL.Query().Get("source_instance")
		apiJSON(w, 200, map[string]any{"inputs": p.externalInputs.Inputs(id), "cursor": p.externalInputs.Cursor(source)})
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req ExternalTaskEventRequest
	// Source: same local control request limit as /task/assign.
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		inputHTTPError(w, 400, err)
		return
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		inputHTTPError(w, 400, errors.New("one request required"))
		return
	}
	e := s.inputEngine(req.Project)
	if e == nil || e.publicProgress == nil || e.ctx.Err() != nil {
		inputHTTPError(w, 409, errors.New("task input journal unavailable"))
		return
	}
	store := e.publicProgress.externalInputs
	var err error
	switch r.URL.Path {
	case "/task/events/source":
		if _, ok := e.publicProgress.Task(req.TaskID); !ok {
			inputHTTPError(w, 404, errors.New("existing task required"))
			return
		}
		err = store.Bind(ExternalEventSource{SourceInstance: req.SourceInstance, ThreadRef: req.ThreadRef, TaskID: req.TaskID, Enabled: req.Enabled})
	case "/task/events/ack":
		if req.SourceInstance == "" || req.EventID == "" || req.Assignment == "" {
			inputHTTPError(w, 400, errors.New("source_instance, event_id and assignment required"))
			return
		}
		var receipt *ExternalEventReceipt
		for _, v := range store.Inputs("") {
			if v.Event.SourceInstance == req.SourceInstance && v.Event.EventID == req.EventID {
				receipt = &v
				break
			}
		}
		if receipt == nil {
			inputHTTPError(w, 404, errors.New("input not found"))
			return
		}
		var target *externalTaskTarget
		target, err = e.externalTaskTarget(receipt.Event)
		if err == nil && target.assignment != req.Assignment {
			err = ErrExternalEventAssignment
		}
		if err == nil {
			err = store.Mark(req.SourceInstance, req.EventID, req.Assignment, "consumed", "")
		}
	default:
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if err != nil {
		inputHTTPError(w, 409, err)
		return
	}
	apiJSON(w, 200, map[string]string{"status": "recorded"})
}
