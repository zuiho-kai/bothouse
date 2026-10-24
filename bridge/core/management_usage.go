package core

import (
	"net/http"
	"strings"
	"time"
)

func (m *ManagementServer) SetUsageLedger(l *UsageLedger) { m.usageLedger = l }
func (m *ManagementServer) handleUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if m.usageLedger == nil {
		http.Error(w, "usage ledger unavailable", http.StatusServiceUnavailable)
		return
	}
	group := strings.TrimPrefix(r.URL.Path, "/api/v1/usage/")
	switch group {
	case "daily", "hourly", "roles", "models":
	default:
		http.NotFound(w, r)
		return
	}
	now := time.Now()
	to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	from := to.AddDate(-1, 0, 1)
	var err error
	if s := r.URL.Query().Get("from"); s != "" {
		from, err = time.ParseInLocation("2006-01-02", s, time.Local)
		if err != nil {
			http.Error(w, "invalid from date", 400)
			return
		}
	}
	if s := r.URL.Query().Get("to"); s != "" {
		to, err = time.ParseInLocation("2006-01-02", s, time.Local)
		if err != nil {
			http.Error(w, "invalid to date", 400)
			return
		}
	}
	if from.After(to) || to.After(from.AddDate(1, 0, 0)) {
		http.Error(w, "date range must be at most one year", 400)
		return
	}
	rows, err := m.usageLedger.Query(from, to, group, r.URL.Query().Get("role"), r.URL.Query().Get("model"))
	if err != nil {
		http.Error(w, "cannot read usage ledger", 500)
		return
	}
	mgmtJSON(w, 200, map[string]any{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"), "timezone": time.Local.String(), "group_by": group, "items": rows})
}
