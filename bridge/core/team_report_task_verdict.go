package core

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The lead's acceptance is kept once per task (board item), not per held report (#1405).
//
// 11-10 had 16 reports posted 「主角色未验收」; in 11 of them the lead had passed or sent the work
// back, but the verdict only counted when it hit the one held record heldReportFor picked at that
// moment: ws-pass with attachments did not touch the text (#1341 #1342 #1395 #1398), ws-forward that
// could not deliver its words exited before rejecting (#1318 #1348 #1359 #1374 #1376), a pass that
// came while the record was wrongly withdrawn found nothing (#1377), a lookup by notes failed (#1327).
// Each fix (#1371 #1378 #1382 #1402) covered one exit and the next one leaked.
//
// Now every pass and reject the bridge accepts is written here under the task's id first, held
// report or not, and every held report of that task settles from it: on the verdict call and on
// each recovery sweep before the unchecked fallback. Only pass and reject count; the timeout and
// the closed/handed-on withdrawal (#1378) are unchanged.

const teamTaskVerdictFile = "verdicts.json"

// teamTaskVerdictKeep: a verdict older than this cannot belong to a report still held.
const teamTaskVerdictKeep = 7 * 24 * time.Hour

// taskVerdict is the lead's last pass or reject of one board item.
type taskVerdict struct {
	Action  string    `json:"action"` // "pass" | "reject"
	Verdict string    `json:"verdict,omitempty"`
	At      time.Time `json:"at"`
}

var taskVerdictMu sync.Mutex

func taskVerdictPath(dataDir string) string {
	if dataDir == "" {
		return ""
	}
	return filepath.Join(dataDir, teamReportDir, teamTaskVerdictFile)
}

func readTaskVerdictsLocked(path string) map[int]taskVerdict {
	out := map[int]taskVerdict{}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

// recordTaskVerdict keeps the lead's pass or reject of board item hid (the newest wins).
func recordTaskVerdict(dataDir string, hid int, action, verdict string, at time.Time) {
	path := taskVerdictPath(dataDir)
	if path == "" || hid <= 0 {
		return
	}
	taskVerdictMu.Lock()
	defer taskVerdictMu.Unlock()
	all := readTaskVerdictsLocked(path)
	for id, v := range all {
		if at.Sub(v.At) > teamTaskVerdictKeep {
			delete(all, id)
		}
	}
	all[hid] = taskVerdict{Action: action, Verdict: verdict, At: at}
	b, err := json.Marshal(all)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		slog.Error("report accept: task verdict dir", "path", path, "error", err)
		return
	}
	if err := AtomicWriteFile(path, b, 0o600); err != nil {
		slog.Error("report accept: task verdict not saved", "board_item", hid, "error", err)
	}
}

// taskVerdictSince is the lead's pass or reject of hid given at or after since (the hold of the
// report asking): an earlier verdict was about an earlier handback and does not settle this one.
func taskVerdictSince(dataDir string, hid int, since time.Time) (taskVerdict, bool) {
	path := taskVerdictPath(dataDir)
	if path == "" || hid <= 0 {
		return taskVerdict{}, false
	}
	taskVerdictMu.Lock()
	v, ok := readTaskVerdictsLocked(path)[hid]
	taskVerdictMu.Unlock()
	if !ok || v.At.Before(since) {
		return taskVerdict{}, false
	}
	return v, true
}

// heldReportsFor lists every held, undelivered record of board item hid on this engine, newest first.
func (e *Engine) heldReportsFor(hid int) []pendingReport {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	var out []pendingReport
	for _, rec := range e.loadReportsLocked() {
		if rec != nil && rec.Held && !rec.delivered() && rec.Board == hid {
			out = append(out, *rec)
		}
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].CreatedAt.After(out[j-1].CreatedAt); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// settleFromTaskVerdict ends held record key with its task's verdict when the lead passed or
// rejected the task after the hold; true when it did. A pass needs what a pass call needs (a
// verdict, and the user's words when the intent check doubted); otherwise it is left to the
// timeout like any report the lead did not judge.
func (e *Engine) settleFromTaskVerdict(key string) bool {
	e.teamExit.mu.Lock()
	rec := e.loadReportsLocked()[key]
	var cp pendingReport
	if rec != nil {
		cp = *rec
	}
	e.teamExit.mu.Unlock()
	if rec == nil || !cp.Held || cp.delivered() || cp.Board <= 0 {
		return false
	}
	v, ok := taskVerdictSince(e.dataDir, cp.Board, cp.CreatedAt)
	if !ok {
		return false
	}
	switch v.Action {
	case "reject":
		return e.rejectHeldReport(key, v.Verdict)
	case "pass":
		if len([]rune(v.Verdict)) < 15 || (cp.Doubt != "" && !verdictQuotesUser(v.Verdict)) {
			return false
		}
		if err := e.deliverHeldReport(key, v.Verdict, false); err != nil {
			slog.Error("report accept: posting a report the lead passed failed; record kept", "board_item", cp.Board, "error", err)
			return false
		}
		slog.Info("report accept: held report settled by the task's pass", "board_item", cp.Board, "at", v.At)
		// Same as the pass call (team_report_accept_api.go): the pass is the acceptance and the
		// board item closes, except a progress report on a task waiting outside (#1378), which
		// stays parked and comes back by itself.
		if cp.Waiting {
			slog.Info("report accept: progress on a task waiting outside posted; item stays parked", "board_item", cp.Board)
		} else if out, err := e.runLeadScript(cp.Platform+":"+cp.Chat, "board", "accepted", strconv.Itoa(cp.Board)); err != nil {
			slog.Warn("report accept: closing the board item failed", "board_item", cp.Board, "error", err, "output", strings.TrimSpace(string(out)))
		}
		return true
	}
	return false
}
