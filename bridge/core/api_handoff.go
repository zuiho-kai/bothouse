package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

// Handoff API (#274). The local socket already has the deployment's trust
// boundary (0600, same as task acceptance); these endpoints only move the
// product-wide lead selection, never platform credentials or agent sessions.

type handoffSwitchRequest struct {
	// Project is the engine serving the call (usually the current lead). It is
	// optional: when empty, the current lead from lead.json is used.
	Project string `json:"project"`
	To      string `json:"to"`
}

func (s *APIServer) handleHandoffStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	st, err := LeadHandoffStatusFor(s.dataDir)
	if err != nil {
		inputHTTPError(w, http.StatusConflict, err)
		return
	}
	apiJSON(w, http.StatusOK, st)
}

func (s *APIServer) handleHandoffShow(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	project := strings.TrimSpace(r.URL.Query().Get("project"))
	if project == "" {
		if st, err := LeadHandoffStatusFor(s.dataDir); err == nil {
			project = st.CurrentLead
		}
	}
	text, err := BuildLeadHandoffText(s.dataDir, project)
	if err != nil {
		inputHTTPError(w, http.StatusConflict, err)
		return
	}
	apiJSON(w, http.StatusOK, map[string]string{"project": project, "text": text})
}

func (s *APIServer) handleHandoffSwitch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req handoffSwitchRequest
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	d.DisallowUnknownFields()
	if err := d.Decode(&req); err != nil {
		inputHTTPError(w, http.StatusBadRequest, errors.New("invalid handoff switch request"))
		return
	}
	if err := d.Decode(new(any)); err != io.EOF {
		inputHTTPError(w, http.StatusBadRequest, errors.New("expected one request"))
		return
	}
	req.Project = strings.TrimSpace(req.Project)
	req.To = strings.TrimSpace(req.To)
	if req.To == "" {
		inputHTTPError(w, http.StatusBadRequest, errors.New("handoff switch: target project is required"))
		return
	}

	sel, _ := readLeadSelectionFull(s.dataDir)
	if req.Project == "" {
		req.Project = sel.Lead
	}
	if req.Project == "" {
		inputHTTPError(w, http.StatusBadRequest, errors.New("handoff switch: project is required before the first selection"))
		return
	}

	s.mu.RLock()
	fromEngine := s.engines[req.Project]
	target := s.engines[req.To]
	s.mu.RUnlock()
	from := sel.Lead
	if from == "" {
		from = req.Project
	}
	if fromEngine == nil && req.Project != from {
		// An explicitly named caller that is neither connected nor the recorded
		// lead is a typo, not the "old lead is gone" case.
		inputHTTPError(w, http.StatusConflict, fmt.Errorf("handoff switch: project %q is not connected", req.Project))
		return
	}
	fromName := sel.Name
	if fromName == "" && fromEngine != nil {
		fromName = fromEngine.DisplayName()
	}
	if from == req.To {
		st, _ := LeadHandoffStatusFor(s.dataDir)
		apiJSON(w, http.StatusOK, map[string]any{"ok": true, "changed": false, "lead": req.To, "handoff": st.Handoff})
		return
	}
	if target == nil || target.ctx.Err() != nil {
		reason := fmt.Sprintf("目标 bot %q 未接入或已停止；任务和交接记录已保留，请重试或选择其他成员。", req.To)
		recordLeadHandoffFailure(s.dataDir, from, fromName, req.To, req.To, reason)
		inputHTTPError(w, http.StatusConflict, errors.New(reason))
		return
	}
	toName := target.DisplayName()
	at := time.Now().UTC()
	if err := writeLeadSelectionFile(s.dataDir, req.To, toName, at); err != nil {
		recordLeadHandoffFailure(s.dataDir, from, fromName, req.To, toName, err.Error())
		inputHTTPError(w, http.StatusInternalServerError, fmt.Errorf("handoff switch: %w", err))
		return
	}
	// lead.json is the record; a gate with its own lead copy is told too (quota_cooling.go
	// notifyGateLead), so `handoff switch` no longer leaves the gate on the old lead.
	for _, e := range []*Engine{fromEngine, target} {
		if e != nil && e.gate != nil {
			if err := e.notifyGateLead(req.To); err != nil {
				slog.Warn("handoff switch: lead.json written, gate not told", "to", req.To, "error", err)
			}
			break
		}
	}
	h := target.observeLeadSelection()
	if h == nil || h.To != req.To {
		h = ensureLeadHandoffRecord(target, from, fromName, req.To, toName, at)
	}
	apiJSON(w, http.StatusOK, map[string]any{"ok": true, "changed": true, "lead": req.To, "handoff": h})
}

func writeLeadSelectionFile(dataDir, lead, name string, at time.Time) error {
	if dataDir == "" {
		return errors.New("handoff switch: data directory is required")
	}
	if strings.TrimSpace(lead) == "" {
		return errors.New("handoff switch: lead is required")
	}
	b, err := json.Marshal(leadSelection{Lead: lead, Name: name, At: at.Format(time.RFC3339)})
	if err != nil {
		return fmt.Errorf("encode lead selection: %w", err)
	}
	if err := AtomicWriteFile(filepath.Join(dataDir, "lead.json"), b, 0o600); err != nil {
		return fmt.Errorf("write lead selection: %w", err)
	}
	return nil
}

// ensureLeadHandoffRecord is the fallback for a switch whose state was already
// observed (for example a retry after the record file was removed): it still
// leaves a persisted record with the same contents and an ack path.
func ensureLeadHandoffRecord(e *Engine, from, fromName, to, toName string, at time.Time) *LeadHandoff {
	if e == nil || e.dataDir == "" {
		return nil
	}
	leadHandoffMu.Lock()
	defer leadHandoffMu.Unlock()
	st := readLeadHandoffStateLocked(e.dataDir)
	if st.Pending != nil && st.Pending.To == to && st.Pending.Status != LeadHandoffSuperseded {
		return st.Pending
	}
	h := &LeadHandoff{
		ID:       "handoff-" + randomProgressID(8),
		From:     from,
		FromName: fromName,
		To:       to,
		ToName:   toName,
		At:       at,
		Status:   LeadHandoffPending,
	}
	if h.ToName == "" {
		h.ToName = e.handoffProjectName(to)
	}
	h.Snapshot = buildLeadHandoffSnapshot(e.dataDir, to, from, e.handoffKnownProjects(from, to), e.handoffChats())
	h.SnapshotAt = h.Snapshot.GeneratedAt
	st.Pending = h
	st.Lead, st.LeadName, st.LeadSince = to, h.ToName, at
	st.History = append(st.History, *h)
	if len(st.History) > leadHandoffHistoryMax {
		st.History = st.History[len(st.History)-leadHandoffHistoryMax:]
	}
	if err := saveLeadHandoffStateLocked(e.dataDir, st); err != nil {
		slog.Warn("lead handoff: save ensured switch", "error", err)
	}
	return h
}
