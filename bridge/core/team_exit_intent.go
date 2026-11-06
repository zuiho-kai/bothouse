package core

import (
	"encoding/json"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// Report intent check (user 11-07「如果我没有兜底的话，你就一坨屎……不可能每个事情我都精通」): before a
// workspace [report] reaches the chat channel, contrib/lead/report-intent-check asks a small model
// whether it tested what the user's words named, whether a conclusion against the user's settled
// direction rests on testing the user's version, and whether its remedy is one the user rejected.
// A clear fail goes back like any other check (bounceWorkspaceExit, wake_limit); past the limit the
// report is posted with intentFailLine first. A doubt never blocks: it goes with the report.

const (
	intentFailPrefix  = "对题检查没过："
	intentDoubtPrefix = "对题疑点："
)

type intentVerdict struct {
	Problems []string `json:"problems"`
	Doubt    string   `json:"doubt"`
}

// reportIntentCheck runs the check for board item id with handoff where. Any failure (script
// missing, model down, bad output) passes: the check never keeps a report from the user.
func (e *Engine) reportIntentCheck(sessionKey, where, body string, id int) (problems []string, doubt string) {
	where = strings.TrimSpace(where)
	if where == "" || strings.TrimSpace(body) == "" {
		return nil, ""
	}
	f, err := os.CreateTemp("", "report-intent-*.txt")
	if err != nil {
		return nil, ""
	}
	defer os.Remove(f.Name())
	_, werr := f.WriteString(body)
	cerr := f.Close()
	if werr != nil || cerr != nil {
		return nil, ""
	}
	out, err := e.runLeadScript(sessionKey, "report-intent-check", "--notes", where, "--body", f.Name(), "--id", strconv.Itoa(id))
	if err != nil {
		slog.Warn("team exit: report intent check did not run; report passes", "board_item", id, "error", err)
		return nil, ""
	}
	v, ok := parseIntentVerdict(out)
	if !ok {
		slog.Warn("team exit: report intent check gave no verdict; report passes", "board_item", id, "output", truncateStr(string(out), 200))
		return nil, ""
	}
	for _, p := range v.Problems {
		if p = strings.TrimSpace(p); p != "" {
			problems = append(problems, intentFailPrefix+p)
		}
	}
	doubt = strings.Join(strings.Fields(v.Doubt), " ")
	slog.Info("team exit: report intent check", "board_item", id, "problems", len(problems), "doubt", doubt != "")
	return problems, doubt
}

// parseIntentVerdict takes the last JSON line of the script's output (warnings may come before it).
func parseIntentVerdict(out []byte) (intentVerdict, bool) {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(l, "{") {
			continue
		}
		var v intentVerdict
		if json.Unmarshal([]byte(l), &v) == nil {
			return v, true
		}
	}
	return intentVerdict{}, false
}

// intentFailLine is the line put before a report posted although the intent check still fails.
func intentFailLine(problems []string) string {
	var parts []string
	for _, p := range problems {
		if strings.HasPrefix(p, intentFailPrefix) {
			parts = append(parts, strings.TrimPrefix(p, intentFailPrefix))
		}
	}
	if parts == nil {
		return ""
	}
	return intentFailPrefix + strings.Join(parts, "；")
}

// withoutIntent drops the intent problems (they get their own line before the report).
func withoutIntent(problems []string) []string {
	var out []string
	for _, p := range problems {
		if !strings.HasPrefix(p, intentFailPrefix) {
			out = append(out, p)
		}
	}
	return out
}

// joinIntentLines joins the non-empty parts one per line.
func joinIntentLines(parts ...string) string {
	var out []string
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, "\n")
}
