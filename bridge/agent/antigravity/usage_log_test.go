package antigravity

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protowire"

	"github.com/chenhg5/cc-connect/core"
)

// Real transcript lines (2026-10-24) with content and thinking removed.
const (
	agySID      = "e797eb87-ecc1-4199-8050-7f0002091a01"
	agyUser     = `{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-10-24T08:52:41Z"}`
	agyResp1    = `{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-10-24T08:52:41Z","input_tokens":24556,"cache_read_tokens":0,"output_tokens":1320}`
	agyTool     = `{"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","created_at":"2026-10-24T08:52:45Z"}`
	agyRunning  = `{"step_index":160,"source":"MODEL","type":"GENERIC","status":"RUNNING","created_at":"2026-10-24T09:01:28Z"}`
	agyResp195  = `{"step_index":195,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-10-24T09:04:41Z","input_tokens":2264,"cache_read_tokens":118825,"output_tokens":210}`
	agyModelOne = "gemini-3.8-flash-n"
)

func agyTranscript(dir, sid string) string {
	return filepath.Join(dir, "brain", sid, ".system_generated", "logs", "transcript.jsonl")
}

func appendLines(t *testing.T, path string, lines ...string) {
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

func genMeta(model string, input, output uint64) []byte {
	var usage, info, out []byte
	usage = protowire.AppendTag(usage, genUsageInput, protowire.VarintType)
	usage = protowire.AppendVarint(usage, input)
	usage = protowire.AppendTag(usage, genUsageOutput, protowire.VarintType)
	usage = protowire.AppendVarint(usage, output)
	info = protowire.AppendTag(info, genFieldUsage, protowire.BytesType)
	info = protowire.AppendBytes(info, usage)
	info = protowire.AppendTag(info, genFieldModel, protowire.BytesType)
	info = protowire.AppendString(info, model)
	out = protowire.AppendTag(out, genFieldInfo, protowire.BytesType)
	return protowire.AppendBytes(out, info)
}

func writeGenMetadata(t *testing.T, dir, sid string, rows ...[]byte) {
	t.Helper()
	path := filepath.Join(dir, "conversations", sid+".db")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("CREATE TABLE IF NOT EXISTS `gen_metadata` (`idx` integer,`data` blob,`size` integer NOT NULL DEFAULT 0,PRIMARY KEY (`idx`))"); err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if _, err := db.Exec("INSERT INTO gen_metadata (idx, data, size) VALUES ((SELECT COUNT(*) FROM gen_metadata), ?, ?)", r, len(r)); err != nil {
			t.Fatal(err)
		}
	}
}

func agyRows(t *testing.T, l *core.UsageLedger, group string) []core.UsageAggregate {
	t.Helper()
	day := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC).Local()
	rows, err := l.Query(day.AddDate(0, 0, -1), day.AddDate(0, 0, 1), group, "", "")
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestUsageLogAntigravityIncrementalWithModel(t *testing.T) {
	dataDir, dir := t.TempDir(), t.TempDir()
	appendLines(t, filepath.Join(dataDir, "sessions", "caihongmao_ab12cd34.json"),
		`{"sessions":{"s1":{"id":"s1","agent_session_id":"`+agySID+`"}}}`)
	writeGenMetadata(t, dir, agySID, genMeta(agyModelOne, 24556, 1320))
	log := agyTranscript(dir, agySID)
	appendLines(t, log, agyUser, agyResp1, agyTool, agyRunning)
	// A conversation the bridge does not own must not be read.
	appendLines(t, agyTranscript(dir, "99999999-0000-0000-0000-000000000000"), agyResp195)

	ledger := core.NewUsageLedger(dataDir, nil)
	src := &UsageLogSource{Dir: dir}
	im := core.NewUsageImporter(dataDir, ledger, src)
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows := agyRows(t, ledger, "models")
	if len(rows) != 1 || rows[0].Model != agyModelOne ||
		rows[0].Responses != 1 || rows[0].Input != 24556 || rows[0].Output != 1320 || rows[0].CacheRead != 0 || rows[0].CacheWrite != 0 {
		t.Fatalf("first import: %+v", rows)
	}

	// agy appends the next response and its gen_metadata row; a model switch
	// shows up as a new name on that row.
	writeGenMetadata(t, dir, agySID, genMeta("gemini-3.8-pro", 2264, 210))
	appendLines(t, log, agyResp195)
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	if err := im.Sync(); err != nil { // idle sync changes nothing
		t.Fatal(err)
	}
	rows = agyRows(t, ledger, "models")
	if len(rows) != 2 {
		t.Fatalf("incremental import: %+v", rows)
	}
	for _, r := range rows {
		if r.Responses != 1 || (r.Model == "gemini-3.8-pro") != (r.CacheRead == 118825) {
			t.Fatalf("incremental import: %+v", rows)
		}
	}
	if rr := agyRows(t, ledger, "roles"); len(rr) != 1 || rr[0].Role != "caihongmao" || rr[0].Responses != 2 {
		t.Fatalf("roles: %+v", rr)
	}
}

func TestUsageLogAntigravityModelFallback(t *testing.T) {
	src := &UsageLogSource{Dir: t.TempDir()}
	rec, ok := src.ParseLine([]byte(agyResp1), agySID, &core.UsageFileState{})
	if !ok || rec.Model != usageLogFallbackModel || rec.Key != "agy:"+agySID+":1" {
		t.Fatalf("%+v %v", rec, ok)
	}
	for _, l := range []string{agyUser, agyTool, agyRunning} {
		if _, ok := src.ParseLine([]byte(l), agySID, &core.UsageFileState{}); ok {
			t.Fatalf("non-usage line parsed: %s", l)
		}
	}
	if got := src.SessionID(agyTranscript(src.Dir, agySID)); got != agySID {
		t.Fatalf("session id %q", got)
	}
	if got := src.SessionID(agyTranscript(src.Dir, "not-a-uuid")); got != "" {
		t.Fatalf("session id %q", got)
	}
}
