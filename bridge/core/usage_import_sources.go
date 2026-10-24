package core

import (
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ClaudeCodeUsageSource reads ~/.claude/projects/*/<sessionId>.jsonl and the
// subagent logs under */<sessionId>/subagents/. Each assistant line carries
// message.usage for one API response; one response (message.id) is written on
// several lines, so message.id is the dedup key.
type ClaudeCodeUsageSource struct{ Dir string } // Dir: the .claude/projects directory

func (ClaudeCodeUsageSource) Name() string { return "claudecode" }

func (s ClaudeCodeUsageSource) Files() ([]string, error) {
	main, err := filepath.Glob(filepath.Join(s.Dir, "*", "*.jsonl"))
	if err != nil {
		return nil, err
	}
	sub, err := filepath.Glob(filepath.Join(s.Dir, "*", "*", "subagents", "*.jsonl"))
	if err != nil {
		return nil, err
	}
	return append(main, sub...), nil
}

func (ClaudeCodeUsageSource) SessionID(path string) string {
	if filepath.Base(filepath.Dir(path)) == "subagents" {
		return filepath.Base(filepath.Dir(filepath.Dir(path)))
	}
	return strings.TrimSuffix(filepath.Base(path), ".jsonl")
}

func (ClaudeCodeUsageSource) ParseLine(line []byte, sid string, _ *UsageFileState) (UsageRecord, bool) {
	var l struct {
		Type      string    `json:"type"`
		Timestamp time.Time `json:"timestamp"`
		RequestID string    `json:"requestId"`
		Message   struct {
			ID    string `json:"id"`
			Model string `json:"model"`
			Usage *struct {
				Input      int64 `json:"input_tokens"`
				CacheWrite int64 `json:"cache_creation_input_tokens"`
				CacheRead  int64 `json:"cache_read_input_tokens"`
				Output     int64 `json:"output_tokens"`
			} `json:"usage"`
		} `json:"message"`
	}
	if json.Unmarshal(line, &l) != nil || l.Type != "assistant" || l.Message.Usage == nil || l.Timestamp.IsZero() {
		return UsageRecord{}, false
	}
	id := l.Message.ID
	if id == "" {
		id = l.RequestID
	}
	if id == "" {
		return UsageRecord{}, false // cannot dedup a line without either id
	}
	u := l.Message.Usage
	model := l.Message.Model
	if model == "" {
		model = "unknown"
	}
	return UsageRecord{Time: l.Timestamp.Local(), Model: model, Input: u.Input, Output: u.Output,
		CacheRead: u.CacheRead, CacheWrite: u.CacheWrite, Known: true, Key: "claudecode:" + id}, true
}

// CodexUsageSource reads <codex_home>/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl
// (and archived_sessions). token_count events repeat; total_token_usage is
// cumulative, so an event counts once per distinct total_tokens value and
// contributes its last_token_usage. The model comes from turn_context lines.
type CodexUsageSource struct{ Home string } // Home: CODEX_HOME, usually ~/.codex

func (CodexUsageSource) Name() string { return "codex" }

func (s CodexUsageSource) Files() ([]string, error) {
	a, err := filepath.Glob(filepath.Join(s.Home, "sessions", "*", "*", "*", "rollout-*.jsonl"))
	if err != nil {
		return nil, err
	}
	b, err := filepath.Glob(filepath.Join(s.Home, "archived_sessions", "rollout-*.jsonl"))
	if err != nil {
		return nil, err
	}
	return append(a, b...), nil
}

// codexSessionIDLen is the length of the UUID at the end of a rollout file name.
const codexSessionIDLen = 36 // SPEC: canonical UUID text form 8-4-4-4-12

func (CodexUsageSource) SessionID(path string) string {
	base := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	if len(base) < codexSessionIDLen {
		return ""
	}
	return base[len(base)-codexSessionIDLen:]
}

type codexLogUsage struct {
	Input      int64 `json:"input_tokens"`
	Cached     int64 `json:"cached_input_tokens"`
	CacheWrite int64 `json:"cache_write_input_tokens"`
	Output     int64 `json:"output_tokens"`
	Total      int64 `json:"total_tokens"`
}

func (CodexUsageSource) ParseLine(line []byte, sid string, st *UsageFileState) (UsageRecord, bool) {
	var l struct {
		Timestamp time.Time `json:"timestamp"`
		Type      string    `json:"type"`
		Payload   struct {
			Type  string `json:"type"`
			Model string `json:"model"`
			Info  *struct {
				Total codexLogUsage `json:"total_token_usage"`
				Last  codexLogUsage `json:"last_token_usage"`
			} `json:"info"`
		} `json:"payload"`
	}
	if json.Unmarshal(line, &l) != nil {
		return UsageRecord{}, false
	}
	if l.Type == "turn_context" {
		if l.Payload.Model != "" {
			st.Model = l.Payload.Model
		}
		return UsageRecord{}, false
	}
	if l.Type != "event_msg" || l.Payload.Type != "token_count" || l.Payload.Info == nil || l.Timestamp.IsZero() {
		return UsageRecord{}, false
	}
	total, last := l.Payload.Info.Total, l.Payload.Info.Last
	if total.Total == 0 {
		return UsageRecord{}, false
	}
	model := st.Model
	if model == "" {
		model = "unknown"
	}
	// OpenAI input_tokens includes cached tokens; the ledger's Input excludes them.
	return UsageRecord{Time: l.Timestamp.Local(), Model: model, Input: max(0, last.Input-last.Cached), Output: last.Output,
		CacheRead: last.Cached, CacheWrite: last.CacheWrite, Known: true,
		Key: "codex:" + sid + ":" + strconv.FormatInt(total.Total, 10)}, true
}
