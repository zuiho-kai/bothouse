package core

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ---- maomao fork: workspace route log (#1448) ----
//
// User 11-11 「你先上线实验，然后明天看看」: every workspace task leaves lines in
// <data_dir>/workspace_route.jsonl that add up per day — one "route" line when the task
// is routed, one "turn" line per finished workspace turn (model, cost, duration). Whether
// the lead sent the [report] back is on the task board (reject_reasons); the route-day
// script joins the two.

const workspaceRouteLogFile = "workspace_route.jsonl"

type routeLogLine struct {
	TS         string  `json:"ts"`
	Day        string  `json:"day"`
	Event      string  `json:"event"` // route | turn
	Task       int     `json:"task,omitempty"`
	Session    string  `json:"session"`
	Route      string  `json:"route,omitempty"` // split | direct
	Model      string  `json:"model,omitempty"`
	Reason     string  `json:"reason,omitempty"`
	Handoff    string  `json:"handoff,omitempty"`
	CostUSD    float64 `json:"cost_usd"`               // turn: what the expensive model cost (0 on the cheap provider)
	CLICostUSD float64 `json:"cli_cost_usd,omitempty"` // turn: the CLI's own figure, priced as Claude even on Qwen
	DurationMS int64   `json:"duration_ms,omitempty"`
}

var routeLogMu sync.Mutex

func (e *Engine) appendRouteLog(l routeLogLine) {
	if e == nil || e.dataDir == "" {
		return
	}
	now := time.Now()
	l.TS, l.Day = now.Format(time.RFC3339), now.Format("2006-01-02")
	b, err := json.Marshal(l)
	if err != nil {
		return
	}
	routeLogMu.Lock()
	defer routeLogMu.Unlock()
	f, err := os.OpenFile(filepath.Join(e.dataDir, workspaceRouteLogFile), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		slog.Warn("workspace route log: open failed", "error", err)
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

// noteWorkspaceTurn logs one finished turn of a routed workspace session.
func (e *Engine) noteWorkspaceTurn(sessionKey string, meta map[string]any, d time.Duration) {
	r, ok := cachedWorkspaceRoute(sessionKey)
	if !ok {
		return // not a routed workspace (no workspace_provider, or a hand-picked model)
	}
	cli, _ := meta[MetaTurnCostUSD].(float64)
	l := routeLogLine{Event: "turn", Task: r.task, Session: teamChatKey(sessionKey), CLICostUSD: cli, DurationMS: d.Milliseconds()}
	if r.cheap {
		l.Route, l.Model = "split", e.workspaceExecModel()
	} else {
		l.Route, l.Model, l.CostUSD = "direct", e.leadModelName(), cli
	}
	e.appendRouteLog(l)
}

func (e *Engine) workspaceExecModel() string {
	e.sessionModelsMu.RLock()
	defer e.sessionModelsMu.RUnlock()
	return e.workspaceExec.model
}
