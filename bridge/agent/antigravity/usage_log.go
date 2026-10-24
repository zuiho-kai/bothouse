package antigravity

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"google.golang.org/protobuf/encoding/protowire"

	"github.com/chenhg5/cc-connect/core"
)

// agy writes one gen_metadata row per model response in
// conversations/<id>.db (data: 228 rows for 228 usage lines in
// e797eb87-..., 2026-10-24). Field numbers read from those rows; usage in
// 1.4.2/1.4.3 equals the transcript's input_tokens/output_tokens.
const (
	genFieldInfo   protowire.Number = 1
	genFieldUsage  protowire.Number = 4
	genUsageInput  protowire.Number = 2
	genUsageOutput protowire.Number = 3
	genFieldModel  protowire.Number = 19 // e.g. "gemini-3.8-flash-n"
)

// usageLogFallbackModel is used when the conversation db has no model name.
const usageLogFallbackModel = "antigravity"

// antigravityCLIDir is where agy keeps conversations and brain logs.
func antigravityCLIDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".gemini", "antigravity-cli"), nil
}

// UsageLogSource reads agy's per-conversation transcript
// <dir>/brain/<conversationId>/.system_generated/logs/transcript.jsonl.
// Every model response is one PLANNER_RESPONSE line with input_tokens,
// cache_read_tokens and output_tokens (no cache writes). The file is only
// appended to (data: chunks/transcript/*.jsonl, agy's 100 KiB byte split of
// it, concatenate to the same bytes; RUNNING lines are never rewritten), so
// the importer's byte offset works. The model is not on the line; it comes
// from gen_metadata in conversations/<conversationId>.db.
type UsageLogSource struct {
	Dir string // the antigravity-cli directory, usually ~/.gemini/antigravity-cli

	mu     sync.Mutex
	models map[string]*convModels
}

type convModels struct {
	stamp    string
	byTokens map[[2]int64]string
	last     string
}

// NewUsageLogSource returns a source rooted at agy's default directory; it
// lists no files when the home directory is unknown.
func NewUsageLogSource() core.UsageLogSource {
	dir, _ := antigravityCLIDir()
	return &UsageLogSource{Dir: dir}
}

func (*UsageLogSource) Name() string { return "agy" }

func (s *UsageLogSource) Files() ([]string, error) {
	if s.Dir == "" {
		return nil, nil
	}
	return filepath.Glob(filepath.Join(s.Dir, "brain", "*", ".system_generated", "logs", "transcript.jsonl"))
}

// SessionID is the brain directory name, which is the conversation id the
// bridge stores as agent_session_id.
func (*UsageLogSource) SessionID(path string) string {
	id := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(path))))
	if !conversationIDPattern.MatchString(id) {
		return ""
	}
	return id
}

func (s *UsageLogSource) ParseLine(line []byte, sid string, _ *core.UsageFileState) (core.UsageRecord, bool) {
	var l struct {
		StepIndex *int64    `json:"step_index"`
		Source    string    `json:"source"`
		Type      string    `json:"type"`
		CreatedAt time.Time `json:"created_at"`
		Input     *int64    `json:"input_tokens"`
		CacheRead int64     `json:"cache_read_tokens"`
		Output    int64     `json:"output_tokens"`
	}
	if json.Unmarshal(line, &l) != nil || l.Source != "MODEL" || l.Input == nil || l.StepIndex == nil || l.CreatedAt.IsZero() {
		return core.UsageRecord{}, false
	}
	return core.UsageRecord{Time: l.CreatedAt.Local(), Model: s.model(sid, *l.Input, l.Output),
		Input: *l.Input, Output: l.Output, CacheRead: l.CacheRead, Known: true,
		Key: "agy:" + sid + ":" + strconv.FormatInt(*l.StepIndex, 10)}, true
}

// model finds the gen_metadata row with the same input/output tokens; rows
// are reloaded when the db or its WAL changes.
func (s *UsageLogSource) model(sid string, input, output int64) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.models == nil {
		s.models = map[string]*convModels{}
	}
	db := filepath.Join(s.Dir, "conversations", sid+".db")
	c := s.models[sid]
	if c == nil || c.byTokens[[2]int64{input, output}] == "" {
		if st := fileStamp(db) + fileStamp(db+"-wal"); c == nil || c.stamp != st {
			c = loadConvModels(db)
			c.stamp = st
			s.models[sid] = c
		}
	}
	if m := c.byTokens[[2]int64{input, output}]; m != "" {
		return m
	}
	if c.last != "" {
		return c.last
	}
	return usageLogFallbackModel
}

func fileStamp(path string) string {
	fi, err := os.Stat(path)
	if err != nil {
		return "-"
	}
	return strconv.FormatInt(fi.Size(), 10) + "@" + strconv.FormatInt(fi.ModTime().UnixNano(), 10) + ";"
}

func loadConvModels(path string) *convModels {
	c := &convModels{byTokens: map[[2]int64]string{}}
	if _, err := os.Stat(path); err != nil {
		return c
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&_pragma=busy_timeout(1000)")
	if err != nil {
		return c
	}
	defer db.Close()
	rows, err := db.Query(`SELECT data FROM gen_metadata ORDER BY idx`)
	if err != nil {
		return c
	}
	defer rows.Close()
	for rows.Next() {
		var data []byte
		if rows.Scan(&data) != nil {
			continue
		}
		info := pbBytes(data, genFieldInfo)
		m := pbString(info, genFieldModel)
		if m == "" {
			continue
		}
		u := pbBytes(info, genFieldUsage)
		c.byTokens[[2]int64{int64(pbUint(u, genUsageInput)), int64(pbUint(u, genUsageOutput))}] = m
		c.last = m
	}
	return c
}
