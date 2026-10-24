package core

import (
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"
)

func (m *ManagementServer) SetUsageLedger(l *UsageLedger) { m.usageLedger = l }

// SetUsageImporter makes usage queries first pull new entries from CLI logs.
func (m *ManagementServer) SetUsageImporter(im *UsageImporter) { m.usageImporter = im }
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
	if err := m.usageImporter.Sync(); err != nil {
		slog.Warn("usage import", "error", err) // serve what was imported
	}
	rows, err := m.usageLedger.Query(from, to, group, r.URL.Query().Get("role"), r.URL.Query().Get("model"))
	if err != nil {
		http.Error(w, "cannot read usage ledger", 500)
		return
	}
	if model := r.URL.Query().Get("model"); model == "" && group != "models" {
		rows = addReplies(rows, m.replyTimes(r.URL.Query().Get("role")), from, to, group)
	}
	mgmtJSON(w, 200, map[string]any{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"), "timezone": time.Local.String(), "group_by": group, "items": rows})
}

// replyTimes lists, per project, when the role posted a reply: the assistant
// turns in the bridge's stored session history (Session.History). A role is
// a project name, the same key the usage ledger uses.
func (m *ManagementServer) replyTimes(role string) map[string][]time.Time {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := map[string][]time.Time{}
	for name, e := range m.engines {
		if (role != "" && role != name) || e == nil || e.sessions == nil {
			continue
		}
		for _, s := range e.sessions.AllSessions() {
			for _, h := range s.GetHistory(0) {
				if h.Role == "assistant" {
					out[name] = append(out[name], h.Timestamp.In(time.Local))
				}
			}
		}
	}
	return out
}

// addReplies fills Replies on the daily, hourly or roles rows for replies
// between from and to (local dates, inclusive); a row is added where a role
// replied but no usage was logged.
func addReplies(rows []UsageAggregate, replies map[string][]time.Time, from, to time.Time, group string) []UsageAggregate {
	end := to.AddDate(0, 0, 1)
	key := func(role string, t time.Time) UsageAggregate {
		switch group {
		case "daily":
			return UsageAggregate{Date: t.Format("2006-01-02"), Hour: -1}
		case "hourly":
			return UsageAggregate{Hour: t.Hour()}
		default:
			return UsageAggregate{Role: role, Hour: -1}
		}
	}
	index := map[[3]any]int{}
	for i, r := range rows {
		index[[3]any{r.Date, r.Hour, r.Role}] = i
	}
	added := false
	for role, times := range replies {
		for _, t := range times {
			if t.Before(from) || !t.Before(end) {
				continue
			}
			k := key(role, t)
			i, ok := index[[3]any{k.Date, k.Hour, k.Role}]
			if !ok {
				rows = append(rows, k)
				i = len(rows) - 1
				index[[3]any{k.Date, k.Hour, k.Role}] = i
				added = true
			}
			rows[i].Replies++
		}
	}
	if added {
		sort.Slice(rows, func(i, j int) bool {
			a, b := rows[i], rows[j]
			if a.Date != b.Date {
				return a.Date < b.Date
			}
			if a.Hour != b.Hour {
				return a.Hour < b.Hour
			}
			return a.Role < b.Role
		})
	}
	return rows
}
