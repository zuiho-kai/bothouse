package devin

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/chenhg5/cc-connect/core"
)

// devinDBFile is the Devin CLI session store inside its data directory.
const devinDBFile = "sessions.db"

// UsageLogSource reads the Devin CLI session store <dir>/sessions.db. Every
// model response lands as an assistant row in message_nodes whose chat_message
// carries metadata.metrics (input_tokens already excludes cache; the cached
// total is context_input_tokens) and metadata.generation_model.
//
// One db holds all sessions, while the importer tracks progress and bridge
// ownership per file, so Files lists one virtual file per session id —
// "<db>#<session id>". ReadUsage returns the rows of that session after the
// row_id watermark kept in st.Offset. Nodes rewritten with the same
// message_id fold into one record by message_id, keyed "devin:<message_id>".
type UsageLogSource struct {
	Dir string // the Devin CLI data directory holding sessions.db
}

// NewUsageLogSource returns a source pointed at the Devin CLI's data
// directory; it lists no files when the home directory is unknown.
func NewUsageLogSource() core.UsageLogSource {
	return &UsageLogSource{Dir: devinCLIDir()}
}

func (*UsageLogSource) Name() string { return "devin" }

// devinCLIDir is where the Devin CLI keeps sessions.db: DEVIN_SESSIONS_DIR
// when set (it relocates the session store), else ~/.local/share/devin/cli on
// macOS and Linux.
func devinCLIDir() string {
	if d := os.Getenv("DEVIN_SESSIONS_DIR"); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "share", "devin", "cli")
}

func openDevinDB(path string) (*sql.DB, error) {
	return sql.Open("sqlite", "file:"+path+"?mode=ro&_pragma=busy_timeout(1000)")
}

// Files lists one virtual file per session id that ever wrote a message node.
func (s *UsageLogSource) Files() ([]string, error) {
	if s.Dir == "" {
		return nil, nil
	}
	dbPath := filepath.Join(s.Dir, devinDBFile)
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			return nil, nil // devin not installed or never ran a session
		}
		return nil, err
	}
	db, err := openDevinDB(dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT DISTINCT session_id FROM message_nodes`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, dbPath+"#"+id)
	}
	return out, rows.Err()
}

// SessionID is the fragment after the last '#' of the virtual file path.
func (*UsageLogSource) SessionID(path string) string {
	if i := strings.LastIndexByte(path, '#'); i >= 0 {
		return path[i+1:]
	}
	return ""
}

// ParseLine is unused: the session store is a sqlite database, not a line log;
// the importer calls ReadUsage instead.
func (*UsageLogSource) ParseLine([]byte, string, *core.UsageFileState) (core.UsageRecord, bool) {
	return core.UsageRecord{}, false
}

// devinChatMetrics is the usage block the CLI persists on an assistant
// message node: input_tokens is the non-cached input, cache_creation_tokens
// the cache write side.
type devinChatMetrics struct {
	MessageID string `json:"message_id"`
	Metadata  struct {
		GenerationModel string `json:"generation_model"`
		Metrics         struct {
			Input      int64 `json:"input_tokens"`
			Output     int64 `json:"output_tokens"`
			CacheRead  int64 `json:"cache_read_tokens"`
			CacheWrite int64 `json:"cache_creation_tokens"`
		} `json:"metrics"`
	} `json:"metadata"`
}

// devinUsageRow folds the nodes of one message_id into one record: the
// earliest persistence time stands for the call, each token field takes the
// max a node reported.
type devinUsageRow struct {
	t               int64
	in, out, cr, cw int64
	model           string
}

// ReadUsage implements core.UsageFileReader: the assistant nodes of sid after
// st.Offset, folded by message_id. st.Offset then moves to the last row_id
// read, so a node is never returned twice.
func (s *UsageLogSource) ReadUsage(path, sid string, st *core.UsageFileState) ([]core.UsageRecord, error) {
	dbPath := path[:strings.LastIndexByte(path, '#')]
	db, err := openDevinDB(dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT row_id, created_at, chat_message FROM message_nodes
		WHERE session_id = ? AND row_id > ?
		  AND json_extract(chat_message, '$.role') = 'assistant'
		  AND json_extract(chat_message, '$.metadata.metrics.input_tokens') IS NOT NULL
		ORDER BY row_id`, sid, st.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var lastRow int64
	byMessage := map[string]*devinUsageRow{}
	for rows.Next() {
		var created int64
		var msg string
		if err := rows.Scan(&lastRow, &created, &msg); err != nil {
			return nil, err
		}
		var cm devinChatMetrics
		if json.Unmarshal([]byte(msg), &cm) != nil || cm.MessageID == "" {
			continue
		}
		b := byMessage[cm.MessageID]
		if b == nil {
			b = &devinUsageRow{t: created}
			byMessage[cm.MessageID] = b
		}
		if created < b.t {
			b.t = created
		}
		m := cm.Metadata.Metrics
		b.in = max(b.in, m.Input)
		b.out = max(b.out, m.Output)
		b.cr = max(b.cr, m.CacheRead)
		b.cw = max(b.cw, m.CacheWrite)
		if b.model == "" {
			b.model = cm.Metadata.GenerationModel
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if lastRow > st.Offset {
		st.Offset = lastRow
	}
	out := make([]core.UsageRecord, 0, len(byMessage))
	var sessionModel string
	modelLookedUp := false
	for mid, b := range byMessage {
		model := b.model
		if model == "" {
			if !modelLookedUp {
				// Older nodes lack metadata.generation_model; the sessions row keeps
				// the model the session asked for — closer than the unpriced "unknown".
				_ = db.QueryRow(`SELECT model FROM sessions WHERE id = ?`, sid).Scan(&sessionModel)
				modelLookedUp = true
			}
			model = sessionModel
			if model == "" {
				model = "unknown"
			}
		}
		out = append(out, core.UsageRecord{
			Time: time.Unix(b.t, 0).Local(), Model: model,
			Input: b.in, Output: b.out, CacheRead: b.cr, CacheWrite: b.cw,
			Known: true, Key: "devin:" + mid,
		})
	}
	return out, nil
}
