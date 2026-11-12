package core

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
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
	if req.Action == "pass" {
		// #1527 (user 11-12 「还后面还有什么可以删的吗？一起搞了吧」): a doubt no longer needs a quoted user line
		// and the verdict has no length floor; only an empty verdict is refused. A real block stays a block upstream.
		if strings.TrimSpace(req.Verdict) == "" {
			http.Error(w, "verdict is required for pass", http.StatusBadRequest)
			return
		}
	}
	// The verdict is the task's, not one record's (#1405): kept first, so a report of this task held
	// now or found again later (a withdrawn record put back, a second copy) settles from it too.
	if len(engines) > 0 {
		recordTaskVerdict(engines[0].dataDir, req.Board, req.Action, req.Verdict, time.Now())
	}
	if rec == nil {
		http.Error(w, "no text report of this board item is waiting for the lead's acceptance", http.StatusNotFound)
		return
	}
	res := TeamReportVerdictResult{Board: req.Board, Action: req.Action}
	if req.Action == "reject" {
		owner.rejectHeldReport(rec.Key, req.Verdict)
	} else {
		if err := owner.deliverHeldReport(rec.Key, req.Verdict, false); err != nil {
			http.Error(w, "post failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		res.Posted = true
		// The lead's pass is the acceptance: the board item closes now. Left 「已交回待验收」, the review
		// nudge hours later had the lead accept it again against the PR's newer head and send work the
		// user already had back for rework (agentm #35 11-10 07:16; contrib/gate/board.py accepted).
		// A progress report on a task waiting outside (#1378) leaves the item parked: it comes back by itself.
		if rec.Waiting {
			slog.Info("report accept: progress on a task waiting outside posted; item stays parked", "board_item", rec.Board)
		} else if out, err := owner.runLeadScript(rec.Platform+":"+rec.Chat, "board", "accepted", strconv.Itoa(rec.Board)); err != nil {
			slog.Warn("report accept: closing the board item failed", "board_item", rec.Board, "error", err, "output", strings.TrimSpace(string(out)))
		}
	}
	// Other held copies of the same task (any engine) end with this verdict too: one post per task,
	// the rest are not left to time out 「主角色未验收」.
	for _, e := range engines {
		for _, other := range e.heldReportsFor(req.Board) {
			if other.Key == rec.Key && e == owner {
				continue
			}
			e.endHeldReport(other.Key, sameTaskVerdict(req.Action, req.Verdict))
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

// sameTaskVerdict is the verdict on a second held copy of a task the lead just judged.
func sameTaskVerdict(action, verdict string) string {
	if action == "reject" {
		return "打回（同一件活）：" + verdict
	}
	return "同一件活已放行，这份不再贴：" + verdict
}
