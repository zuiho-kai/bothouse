package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Real log lines (2026-10-24) with message content and rate limits removed.
const (
	claudeSID   = "d52451e4-5186-497b-8c7a-4cdaa12fc15f"
	claudeLine1 = `{"type": "assistant", "timestamp": "2026-10-24T08:48:42.512Z", "sessionId": "d52451e4-5186-497b-8c7a-4cdaa12fc15f", "requestId": "req_011CgLmokJJy3rYb5vWzGjgY", "message": {"id": "msg_011CgLmoqMfKo81A6pWYvbQm", "model": "claude-opus-5-5", "role": "assistant", "usage": {"input_tokens": 2, "cache_creation_input_tokens": 31555, "cache_read_input_tokens": 18496, "output_tokens": 270, "output_tokens_details": {"thinking_tokens": 38}, "cache_creation": {"ephemeral_1h_input_tokens": 31555, "ephemeral_5m_input_tokens": 0}}, "content": []}}`
	// Same message.id written again on a later line (one line per content block).
	claudeLine1Again = `{"type": "assistant", "timestamp": "2026-10-24T08:48:43.100Z", "sessionId": "d52451e4-5186-497b-8c7a-4cdaa12fc15f", "requestId": "req_011CgLmokJJy3rYb5vWzGjgY", "message": {"id": "msg_011CgLmoqMfKo81A6pWYvbQm", "model": "claude-opus-5-5", "role": "assistant", "usage": {"input_tokens": 2, "cache_creation_input_tokens": 31555, "cache_read_input_tokens": 18496, "output_tokens": 270}, "content": []}}`
	claudeLine2      = `{"type": "assistant", "timestamp": "2026-10-24T08:49:10.000Z", "sessionId": "d52451e4-5186-497b-8c7a-4cdaa12fc15f", "requestId": "req_2", "message": {"id": "msg_2", "model": "claude-opus-5-5", "role": "assistant", "usage": {"input_tokens": 5, "cache_creation_input_tokens": 100, "cache_read_input_tokens": 50000, "output_tokens": 30}, "content": []}}`
	claudeUser       = `{"type": "user", "timestamp": "2026-10-24T08:48:40.000Z", "sessionId": "d52451e4-5186-497b-8c7a-4cdaa12fc15f", "message": {"role": "user", "content": []}}`

	codexSID      = "01a16d1a-ecfa-7d41-9c11-2d1f0a3b4c5d"
	codexTurnCtx  = `{"timestamp": "2026-10-24T08:50:46.304Z", "type": "turn_context", "payload": {"turn_id": "01a16d1a-f559-77f2-afaa-c9d69b74b4eb", "cwd": "/tmp/x", "model": "gpt-6.1-sol"}}`
	codexTokenOne = `{"timestamp": "2026-10-24T08:50:53.542Z", "ordinal": 19, "type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 38847, "cached_input_tokens": 0, "cache_write_input_tokens": 0, "output_tokens": 464, "reasoning_output_tokens": 240, "total_tokens": 39311}, "last_token_usage": {"input_tokens": 38847, "cached_input_tokens": 0, "cache_write_input_tokens": 0, "output_tokens": 464, "reasoning_output_tokens": 240, "total_tokens": 39311}, "model_context_window": 258400}}}`
	codexTokenTwo = `{"timestamp": "2026-10-24T08:51:05.000Z", "type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 78847, "cached_input_tokens": 30000, "cache_write_input_tokens": 0, "output_tokens": 564, "reasoning_output_tokens": 260, "total_tokens": 79411}, "last_token_usage": {"input_tokens": 40000, "cached_input_tokens": 30000, "cache_write_input_tokens": 0, "output_tokens": 100, "reasoning_output_tokens": 20, "total_tokens": 40100}, "model_context_window": 258400}}}`
	codexNullInfo = `{"timestamp": "2026-10-24T08:50:47.000Z", "type": "event_msg", "payload": {"type": "token_count", "info": null}}`
)

func writeLines(t *testing.T, path string, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, l := range lines {
		if _, err := f.WriteString(l + "\n"); err != nil {
			t.Fatal(err)
		}
	}
}

func writeSessionStore(t *testing.T, dataDir, file, agentSID string) {
	t.Helper()
	writeLines(t, filepath.Join(dataDir, "sessions", file),
		`{"sessions":{"s1":{"id":"s1","agent_session_id":"`+agentSID+`","past_agent_session_ids":["old-id"]}}}`)
}

func usageRows(t *testing.T, l *UsageLedger, group string) []UsageAggregate {
	t.Helper()
	day := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC).Local()
	rows, err := l.Query(day.AddDate(0, 0, -1), day.AddDate(0, 0, 1), group, "", "")
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestUsageImportClaudeCodeDedupAndIncremental(t *testing.T) {
	dataDir, projects := t.TempDir(), t.TempDir()
	writeSessionStore(t, dataDir, "maomao_ab12cd34.json", claudeSID)
	log := filepath.Join(projects, "-tmp-maomao", claudeSID+".jsonl")
	writeLines(t, log, claudeUser, claudeLine1, claudeLine1Again)
	// A session the bridge does not own must not be read.
	writeLines(t, filepath.Join(projects, "-tmp-other", "99999999-0000-0000-0000-000000000000.jsonl"), claudeLine2)

	ledger := NewUsageLedger(dataDir, nil)
	im := NewUsageImporter(dataDir, ledger, ClaudeCodeUsageSource{Dir: projects})
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows := usageRows(t, ledger, "roles")
	if len(rows) != 1 || rows[0].Role != "maomao" || rows[0].Responses != 1 || rows[0].Input != 2 ||
		rows[0].Output != 270 || rows[0].CacheRead != 18496 || rows[0].CacheWrite != 31555 {
		t.Fatalf("first import: %+v", rows)
	}

	// Appended lines: a repeat of the first message, a new message, and a
	// half-written line that must wait until it is complete.
	writeLines(t, log, claudeLine1Again, claudeLine2)
	f, _ := os.OpenFile(log, os.O_APPEND|os.O_WRONLY, 0o600)
	half := claudeLine2[:40]
	f.WriteString(half)
	f.Close()
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows = usageRows(t, ledger, "models")
	if len(rows) != 1 || rows[0].Model != "claude-opus-5-5" || rows[0].Responses != 2 || rows[0].Input != 7 || rows[0].Output != 300 {
		t.Fatalf("incremental import: %+v", rows)
	}
	// Re-running with nothing new changes nothing.
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	if rows = usageRows(t, ledger, "roles"); rows[0].Responses != 2 {
		t.Fatalf("idle sync changed totals: %+v", rows)
	}
}

func TestUsageImportClaudeCodeSubagentLogsBelongToParent(t *testing.T) {
	dataDir, projects := t.TempDir(), t.TempDir()
	writeSessionStore(t, dataDir, "maomao_ab12cd34.json", claudeSID)
	writeLines(t, filepath.Join(projects, "-tmp-maomao", claudeSID, "subagents", "agent-a1.jsonl"), claudeLine2)
	ledger := NewUsageLedger(dataDir, nil)
	if err := NewUsageImporter(dataDir, ledger, ClaudeCodeUsageSource{Dir: projects}).Sync(); err != nil {
		t.Fatal(err)
	}
	if rows := usageRows(t, ledger, "roles"); len(rows) != 1 || rows[0].Role != "maomao" || rows[0].CacheRead != 50000 {
		t.Fatalf("%+v", rows)
	}
}

func TestUsageImportCodexDedupByCumulativeTotal(t *testing.T) {
	dataDir, home := t.TempDir(), t.TempDir()
	writeSessionStore(t, dataDir, "longniang_0f1e2d3c.json", codexSID)
	log := filepath.Join(home, "sessions", "2026", "10", "24", "rollout-2026-10-24T08-50-46-"+codexSID+".jsonl")
	writeLines(t, log, codexTurnCtx, codexNullInfo, codexTokenOne, codexTokenOne)

	ledger := NewUsageLedger(dataDir, nil)
	im := NewUsageImporter(dataDir, ledger, CodexUsageSource{Home: home})
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	// The second import starts mid-file: the model must come from saved state,
	// and a repeated earlier event must not count again.
	writeLines(t, log, codexTokenOne, codexTokenTwo, codexTokenTwo)
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows := usageRows(t, ledger, "models")
	if len(rows) != 1 || rows[0].Model != "gpt-6.1-sol" || rows[0].Responses != 2 {
		t.Fatalf("%+v", rows)
	}
	r := rows[0]
	// Input excludes cached tokens: 38847 + (40000-30000).
	if r.Input != 48847 || r.CacheRead != 30000 || r.Output != 564 || r.CacheWrite != 0 {
		t.Fatalf("%+v", r)
	}
	if rr := usageRows(t, ledger, "roles"); rr[0].Role != "longniang" {
		t.Fatalf("%+v", rr)
	}
}

func TestUsageImportRereadsReplacedFileWithoutDoubleCounting(t *testing.T) {
	dataDir, home := t.TempDir(), t.TempDir()
	writeSessionStore(t, dataDir, "longniang_0f1e2d3c.json", codexSID)
	log := filepath.Join(home, "archived_sessions", "rollout-x-"+codexSID+".jsonl")
	writeLines(t, log, codexTurnCtx, codexTokenOne, codexTokenTwo)
	ledger := NewUsageLedger(dataDir, nil)
	im := NewUsageImporter(dataDir, ledger, CodexUsageSource{Home: home})
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(log, []byte(codexTurnCtx+"\n"+codexTokenOne+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	if rows := usageRows(t, ledger, "roles"); rows[0].Responses != 2 {
		t.Fatalf("%+v", rows)
	}
	b, _ := os.ReadFile(filepath.Join(dataDir, "usage", "import-state.json"))
	if !strings.Contains(string(b), "codex:") {
		t.Fatalf("state not saved: %s", b)
	}
}

func TestUsageImportCodexRepeatOnLaterDayCountsOnce(t *testing.T) {
	dataDir, home := t.TempDir(), t.TempDir()
	writeSessionStore(t, dataDir, "longniang_0f1e2d3c.json", codexSID)
	log := filepath.Join(home, "sessions", "2026", "10", "24", "rollout-2026-10-24T08-50-46-"+codexSID+".jsonl")
	later := strings.Replace(codexTokenOne, "2026-10-24T08:50:53", "2026-10-30T08:50:53", 1)
	writeLines(t, log, codexTurnCtx, codexTokenOne, later)
	ledger := NewUsageLedger(dataDir, nil)
	im := NewUsageImporter(dataDir, ledger, CodexUsageSource{Home: home})
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 10, 20, 0, 0, 0, 0, time.Local)
	rows, err := ledger.Query(from, from.AddDate(0, 0, 14), "roles", "", "")
	if err != nil || len(rows) != 1 || rows[0].Responses != 1 {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
}
