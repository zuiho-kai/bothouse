package devin

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Rows shaped like the real store (2026-11-22): message_nodes persists one
// row per chat node; assistant rows carry metadata.metrics and
// metadata.generation_model inside chat_message.
const (
	devinSID      = "gravel-magic"
	devinSIDUnown = "stray-cat"

	devinUser   = `{"role":"user","message_id":"u-1","metadata":{}}`
	devinRespA1 = `{"role":"assistant","message_id":"mid-a","metadata":{"generation_model":"swe-2-max","metrics":{"input_tokens":100,"output_tokens":10,"cache_read_tokens":5,"cache_creation_tokens":2,"context_input_tokens":105}}}`
	// The same message_id persisted again on a later node: the fields take
	// the max a node reported, the time keeps the earliest persistence.
	devinRespA2  = `{"role":"assistant","message_id":"mid-a","metadata":{"generation_model":"swe-2-max","metrics":{"input_tokens":150,"output_tokens":10,"cache_read_tokens":5,"cache_creation_tokens":null,"context_input_tokens":155}}}`
	devinNoMid   = `{"role":"assistant","metadata":{"generation_model":"swe-2-max","metrics":{"input_tokens":999,"output_tokens":9}}}`
	devinNoInput = `{"role":"assistant","message_id":"mid-noinput","metadata":{"generation_model":"swe-2-max","metrics":{"output_tokens":9}}}`
	devinRespB   = `{"role":"assistant","message_id":"mid-b","metadata":{"generation_model":"swe-2-max","metrics":{"input_tokens":7,"output_tokens":3,"cache_read_tokens":0,"cache_creation_tokens":0}}}`
	devinOther   = `{"role":"assistant","message_id":"mid-x","metadata":{"generation_model":"swe-2-max","metrics":{"input_tokens":42,"output_tokens":4}}}`
)

var devinDay = time.Date(2026, 11, 22, 10, 0, 0, 0, time.Local).Unix()

func openTestDB(t *testing.T, dir string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, devinDBFile))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE sessions (id TEXT PRIMARY KEY)`,
		`CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
			node_id INTEGER NOT NULL, parent_node_id INTEGER, chat_message TEXT NOT NULL,
			created_at INTEGER NOT NULL, metadata TEXT)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func addNode(t *testing.T, db *sql.DB, sid, msg string, created int64) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO message_nodes (session_id, node_id, chat_message, created_at)
		VALUES (?, (SELECT COALESCE(MAX(node_id),0)+1 FROM message_nodes WHERE session_id=?), ?, ?)`,
		sid, sid, msg, created); err != nil {
		t.Fatal(err)
	}
}

func writeDevinSessionStore(t *testing.T, dataDir, agentSID string) {
	t.Helper()
	dir := filepath.Join(dataDir, "sessions")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"sessions":{"s1":{"id":"s1","agent_session_id":%q}}}`, agentSID)
	if err := os.WriteFile(filepath.Join(dir, "devin_ab12cd34.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func devinUsageRows(t *testing.T, l *core.UsageLedger, group string) []core.UsageAggregate {
	t.Helper()
	from := time.Unix(devinDay, 0).AddDate(0, 0, -1)
	rows, err := l.Query(from, from.AddDate(0, 0, 2), group, "", "")
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestUsageLogDevinDedupAndIncremental(t *testing.T) {
	dataDir, cliDir := t.TempDir(), t.TempDir()
	writeDevinSessionStore(t, dataDir, devinSID)
	db := openTestDB(t, cliDir)
	defer db.Close()
	for _, s := range []string{devinSID, devinSIDUnown} {
		if _, err := db.Exec(`INSERT INTO sessions (id) VALUES (?)`, s); err != nil {
			t.Fatal(err)
		}
	}
	addNode(t, db, devinSID, devinUser, devinDay)
	addNode(t, db, devinSID, devinRespA1, devinDay)
	addNode(t, db, devinSID, devinRespA2, devinDay+60)
	addNode(t, db, devinSID, devinNoMid, devinDay+61)
	addNode(t, db, devinSID, devinNoInput, devinDay+62)
	// A session the bridge does not own must not be read.
	addNode(t, db, devinSIDUnown, devinOther, devinDay)

	ledger := core.NewUsageLedger(dataDir, nil)
	src := &UsageLogSource{Dir: cliDir}
	im := core.NewUsageImporter(dataDir, ledger, src)
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows := devinUsageRows(t, ledger, "roles")
	if len(rows) != 1 || rows[0].Role != "devin" || rows[0].Responses != 1 {
		t.Fatalf("first import: %+v", rows)
	}
	if r := rows[0]; r.Input != 150 || r.Output != 10 || r.CacheRead != 5 || r.CacheWrite != 2 {
		t.Fatalf("folded usage: %+v", r)
	}
	if rows := devinUsageRows(t, ledger, "models"); len(rows) != 1 || rows[0].Model != "swe-2-max" {
		t.Fatalf("model: %+v", rows)
	}

	// A new turn appends new rows; an idle sync must not count anything again.
	addNode(t, db, devinSID, devinRespB, devinDay+3600)
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows = devinUsageRows(t, ledger, "roles")
	if len(rows) != 1 || rows[0].Responses != 2 || rows[0].Input != 157 || rows[0].Output != 13 {
		t.Fatalf("incremental import: %+v", rows)
	}
	b, _ := os.ReadFile(filepath.Join(dataDir, "usage", "import-state.json"))
	if !strings.Contains(string(b), "devin:") {
		t.Fatalf("state not saved: %s", b)
	}
}

func TestUsageLogDevinFilesAndSessionID(t *testing.T) {
	if files, err := (&UsageLogSource{}).Files(); err != nil || files != nil {
		t.Fatalf("empty dir: %v %v", files, err)
	}
	cliDir := t.TempDir()
	if files, err := (&UsageLogSource{Dir: cliDir}).Files(); err != nil || files != nil {
		t.Fatalf("no db: %v %v", files, err)
	}
	db := openTestDB(t, cliDir)
	defer db.Close()
	addNode(t, db, devinSID, devinRespA1, devinDay)
	addNode(t, db, devinSIDUnown, devinOther, devinDay)

	src := &UsageLogSource{Dir: cliDir}
	files, err := src.Files()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]string{}
	for _, f := range files {
		byID[src.SessionID(f)] = f
	}
	if len(byID) != 2 || byID[devinSID] == "" || byID[devinSIDUnown] == "" {
		t.Fatalf("files: %v", files)
	}
	if got := src.SessionID(filepath.Join(cliDir, devinDBFile)); got != "" {
		t.Fatalf("bare db path gave session %q", got)
	}

	st := &core.UsageFileState{}
	recs, err := src.ReadUsage(byID[devinSID], devinSID, st)
	if err != nil || len(recs) != 1 {
		t.Fatalf("read: %v %v", recs, err)
	}
	r := recs[0]
	if r.Key != "devin:mid-a" || r.Model != "swe-2-max" || r.Input != 100 || r.Output != 10 ||
		r.CacheRead != 5 || r.CacheWrite != 2 || !r.Known || r.Time.Unix() != devinDay {
		t.Fatalf("record: %+v", r)
	}
	if st.Offset == 0 {
		t.Fatal("watermark did not advance")
	}
	if recs, err := src.ReadUsage(byID[devinSID], devinSID, st); err != nil || len(recs) != 0 {
		t.Fatalf("second read returned %d records: %v", len(recs), err)
	}
}
