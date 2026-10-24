package core

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// UsageLogSource reads token usage from one CLI's own session logs, so the
// bridge does not keep a second record on the reply path.
//
// To add a backend: implement Files (where its logs live), SessionID (which
// agent session a file belongs to, read from the path so unrelated files are
// never opened) and ParseLine (one log line to zero or one record).
type UsageLogSource interface {
	// Name prefixes record keys and state entries, e.g. "claudecode".
	Name() string
	// Files lists candidate log files.
	Files() ([]string, error)
	// SessionID returns the agent session id that owns path, or "".
	SessionID(path string) string
	// ParseLine turns one complete log line into a record. st holds per-file
	// state that survives between imports (e.g. the current model).
	// Returned records need Time, Model, token fields and Key; Role is filled in
	// by the importer.
	ParseLine(line []byte, sessionID string, st *UsageFileState) (UsageRecord, bool)
}

// UsageFileReader is implemented by sources whose files cannot be read as
// plain appended lines (e.g. compressed logs). ReadUsage returns the records
// after st and advances st; it must never return a record twice for the same
// st, and a file it cannot finish yet is left for the next call.
type UsageFileReader interface {
	ReadUsage(path, sessionID string, st *UsageFileState) ([]UsageRecord, error)
}

// UsageFileState is the import progress of one log file.
type UsageFileState struct {
	Offset int64  `json:"offset"`
	Model  string `json:"model,omitempty"`
}

type usageImportState struct {
	Files map[string]*UsageFileState `json:"files"`
}

// UsageImporter incrementally copies usage from CLI logs into the ledger.
// Sessions are mapped to roles through the bridge's own session files
// (<dataDir>/sessions/<project>_<hash>.json, agent_session_id and
// past_agent_session_ids); logs of sessions the bridge does not own are skipped.
type UsageImporter struct {
	mu      sync.Mutex
	dataDir string
	ledger  *UsageLedger
	sources []UsageLogSource
}

func NewUsageImporter(dataDir string, ledger *UsageLedger, sources ...UsageLogSource) *UsageImporter {
	return &UsageImporter{dataDir: dataDir, ledger: ledger, sources: sources}
}

func (im *UsageImporter) statePath() string {
	return filepath.Join(im.dataDir, "usage", "import-state.json")
}

func (im *UsageImporter) loadState() usageImportState {
	st := usageImportState{Files: map[string]*UsageFileState{}}
	b, err := os.ReadFile(im.statePath())
	if err == nil {
		_ = json.Unmarshal(b, &st)
	}
	if st.Files == nil {
		st.Files = map[string]*UsageFileState{}
	}
	return st
}

func (im *UsageImporter) saveState(st usageImportState) error {
	if err := os.MkdirAll(filepath.Dir(im.statePath()), 0o700); err != nil {
		return err
	}
	b, err := json.Marshal(st)
	if err != nil {
		return err
	}
	tmp := im.statePath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, im.statePath())
}

// SessionRoles maps agent session ids to bridge project names.
func SessionRoles(dataDir string) map[string]string {
	roles := map[string]string{}
	files, _ := filepath.Glob(filepath.Join(dataDir, "sessions", "*.json"))
	for _, f := range files {
		base := strings.TrimSuffix(filepath.Base(f), ".json")
		project := base
		if i := strings.LastIndex(base, "_"); i > 0 {
			project = base[:i]
		}
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var snap struct {
			Sessions map[string]struct {
				AgentSessionID      string   `json:"agent_session_id"`
				PastAgentSessionIDs []string `json:"past_agent_session_ids"`
			} `json:"sessions"`
		}
		if json.Unmarshal(b, &snap) != nil {
			continue
		}
		for _, s := range snap.Sessions {
			for _, id := range append([]string{s.AgentSessionID}, s.PastAgentSessionIDs...) {
				if id != "" {
					roles[id] = project
				}
			}
		}
	}
	return roles
}

// Sync imports everything appended since the last call.
func (im *UsageImporter) Sync() error {
	if im == nil {
		return nil
	}
	im.mu.Lock()
	defer im.mu.Unlock()
	roles := SessionRoles(im.dataDir)
	st := im.loadState()
	var firstErr error
	for _, src := range im.sources {
		files, err := src.Files()
		if err != nil {
			slog.Debug("usage import: list files", "source", src.Name(), "error", err)
			continue
		}
		for _, path := range files {
			sid := src.SessionID(path)
			role := roles[sid]
			if sid == "" || role == "" {
				continue
			}
			key := src.Name() + ":" + path
			fs := st.Files[key]
			if fs == nil {
				fs = &UsageFileState{}
			}
			next := *fs
			var records []UsageRecord
			if fr, ok := src.(UsageFileReader); ok {
				records, err = fr.ReadUsage(path, sid, &next)
			} else {
				records, err = readUsageLines(path, src, sid, &next)
			}
			if err != nil {
				if firstErr == nil {
					firstErr = fmt.Errorf("usage import %s: %w", path, err)
				}
				continue
			}
			for i := range records {
				records[i].Role = role
			}
			if len(records) > 0 {
				if err := im.ledger.Upsert(records); err != nil {
					if firstErr == nil {
						firstErr = err
					}
					continue
				}
			}
			st.Files[key] = &next
		}
	}
	if err := im.saveState(st); err != nil && firstErr == nil {
		firstErr = err
	}
	return firstErr
}

// readUsageLines parses complete lines after st.Offset and advances it. A
// trailing line without '\n' is still being written and is left for later.
// A file shorter than the offset was replaced, so it is read from the start;
// record keys make the re-read idempotent.
func readUsageLines(path string, src UsageLogSource, sid string, st *UsageFileState) ([]UsageRecord, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() < st.Offset {
		st.Offset, st.Model = 0, ""
	}
	if info.Size() == st.Offset {
		return nil, nil
	}
	if _, err := f.Seek(st.Offset, io.SeekStart); err != nil {
		return nil, err
	}
	var out []UsageRecord
	r := bufio.NewReader(f)
	for {
		line, err := r.ReadBytes('\n')
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		st.Offset += int64(len(line))
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		if rec, ok := src.ParseLine(line, sid, st); ok {
			out = append(out, rec)
		}
	}
}
