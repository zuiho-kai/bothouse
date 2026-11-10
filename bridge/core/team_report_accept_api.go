package core

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// TeamReportVerdictResult answers POST /team/report/verdict (`bothouse report pass|reject`).
type TeamReportVerdictResult struct {
	Board  int    `json:"board"`
	Action string `json:"action"`
	Posted bool   `json:"posted"`
}

// handleTeamReportVerdict ends a [report] held for the lead (team_report_accept.go): action
// "pass" posts it as the 📬 headline, "reject" drops it unposted (ws-forward sends the work back).
func (s *APIServer) handleTeamReportVerdict(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Board   int    `json:"board"`
		Action  string `json:"action"`
		Verdict string `json:"verdict"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	req.Verdict = strings.TrimSpace(req.Verdict)
	if req.Board <= 0 || (req.Action != "pass" && req.Action != "reject") {
		http.Error(w, "board (>0) and action (pass|reject) are required", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	names := make([]string, 0, len(s.engines))
	for n := range s.engines {
		names = append(names, n)
	}
	sort.Strings(names)
	engines := make([]*Engine, 0, len(names))
	for _, n := range names {
		engines = append(engines, s.engines[n])
	}
	s.mu.RUnlock()
	var owner *Engine
	var rec *pendingReport
	for _, e := range engines {
		if got := e.heldReportFor(req.Board); got != nil && (rec == nil || got.CreatedAt.After(rec.CreatedAt)) {
			owner, rec = e, got
		}
	}
	if rec == nil {
		http.Error(w, "no text report of this board item is waiting for the lead's acceptance", http.StatusNotFound)
		return
	}
	res := TeamReportVerdictResult{Board: req.Board, Action: req.Action}
	if req.Action == "reject" {
		owner.rejectHeldReport(rec.Key, req.Verdict)
	} else {
		if len([]rune(req.Verdict)) < 15 {
			http.Error(w, "verdict is required for pass: item by item, which expectation is met and the evidence", http.StatusBadRequest)
			return
		}
		if rec.Doubt != "" && !verdictQuotesUser(req.Verdict) {
			http.Error(w, doubtPassRefusal(rec.Doubt), http.StatusConflict)
			return
		}
		if err := owner.deliverHeldReport(rec.Key, req.Verdict, false); err != nil {
			http.Error(w, "post failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		res.Posted = true
		// The lead's pass is the acceptance: the board item closes now. Left 「已交回待验收」, the review
		// nudge hours later had the lead accept it again against the PR's newer head and send work the
		// user already had back for rework (agentm #35 11-10 07:16; contrib/gate/board.py accepted).
		if out, err := owner.runLeadScript(rec.Platform+":"+rec.Chat, "board", "accepted", strconv.Itoa(rec.Board)); err != nil {
			slog.Warn("report accept: closing the board item failed", "board_item", rec.Board, "error", err, "output", strings.TrimSpace(string(out)))
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}
