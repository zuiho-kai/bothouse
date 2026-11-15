package core

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// Session history on disk (#1627 batch 21).
//
// The session store file (<data>/sessions/<project>_<hash>.json) holds session metadata only. Each
// session's history lives next to it, one JSON object per line, appended as the conversation goes:
//
//	<data>/sessions/<project>_<hash>.history/<session id>.jsonl
//
// Before this, every save rewrote the whole store file with every session's full history in it, so
// the cost of one turn grew with everything ever said in the project. Nothing is capped or dropped.
//
// A store file written by an older bridge still has "history" inside each session. load() moves it
// out once: the old file is copied to <store>.pre-history.bak first, then the entries are written to
// the per-session files and the store file is saved without them.

// sessionHistoryBackupSuffix names the copy of the store file kept by the one-time migration.
const sessionHistoryBackupSuffix = ".pre-history.bak"

// SessionHistoryDir is the directory holding the per-session history files of a store file.
func SessionHistoryDir(storePath string) string {
	return strings.TrimSuffix(storePath, ".json") + ".history"
}

func sessionHistoryPath(storePath, id string) string {
	safe := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		}
		return '_'
	}, id)
	if safe == "" {
		safe = "_"
	}
	return filepath.Join(SessionHistoryDir(storePath), safe+".jsonl")
}

// ReadSessionHistory returns the stored history of one session of a store file, oldest first.
// A missing file is an empty history.
func ReadSessionHistory(storePath, id string) ([]HistoryEntry, error) {
	entries, _, err := readSessionHistoryFile(sessionHistoryPath(storePath, id))
	return entries, err
}

// readSessionHistoryFile also reports whether the file is clean: every line parsed and the last one
// ends with a newline. A file that is not clean (a write cut short) is rewritten on the next save,
// so a later append never lands on the tail of a broken line.
func readSessionHistoryFile(path string) (entries []HistoryEntry, clean bool, err error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, true, nil
		}
		return nil, false, err
	}
	clean = len(data) == 0 || data[len(data)-1] == '\n'
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 0, 64*1024), len(data)+1)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var e HistoryEntry
		if json.Unmarshal(line, &e) != nil {
			clean = false
			continue
		}
		entries = append(entries, e)
	}
	return entries, clean, sc.Err()
}

func encodeSessionHistory(entries []HistoryEntry) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf) // one object and a newline per Encode
	enc.SetEscapeHTML(false)
	for _, e := range entries {
		if err := enc.Encode(e); err != nil {
			return nil, err
		}
	}
	return buf.Bytes(), nil
}

func appendSessionHistoryFile(path string, entries []HistoryEntry) error {
	if len(entries) == 0 {
		return nil
	}
	data, err := encodeSessionHistory(entries)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// rewriteSessionHistoryFile replaces the file with entries; no entries removes it.
func rewriteSessionHistoryFile(path string, entries []HistoryEntry) error {
	if len(entries) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	data, err := encodeSessionHistory(entries)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return AtomicWriteFile(path, data, 0o644)
}

// flushHistoryLocked brings the session's history file up to date with s.History: the entries added
// since the last flush are appended; after a clear or a merge the file is replaced. s.mu must be held.
// On failure nothing is marked saved, so the next save tries again.
func (s *Session) flushHistoryLocked(storePath, id string) {
	path := sessionHistoryPath(storePath, id)
	var err error
	if s.histRewrite || len(s.History) < s.histSaved {
		err = rewriteSessionHistoryFile(path, s.History)
	} else {
		err = appendSessionHistoryFile(path, s.History[s.histSaved:])
	}
	if err != nil {
		slog.Error("session: failed to write history", "path", path, "error", err)
		return
	}
	s.histRewrite = false
	s.histSaved = len(s.History)
}

// loadHistories fills every loaded session's History from its history file. Sessions that still
// carry history inside the store file (written by an older bridge) are migrated: storeData, the
// store file as read, is kept as a backup, and their entries go to the history files. It reports
// whether the store file has to be saved again to drop the inline history.
func (sm *SessionManager) loadHistories(storeData []byte) (migrated bool) {
	for _, s := range sm.sessions {
		if len(s.History) > 0 {
			migrated = true
			break
		}
	}
	if migrated {
		bak := sm.storePath + sessionHistoryBackupSuffix
		if _, err := os.Stat(bak); os.IsNotExist(err) {
			if err := AtomicWriteFile(bak, storeData, 0o644); err != nil {
				slog.Error("session: failed to back up store before history migration", "path", bak, "error", err)
			} else {
				slog.Info("session: store backed up before history migration", "path", bak)
			}
		}
	}
	moved := 0
	for id, s := range sm.sessions {
		inline := s.History
		path := sessionHistoryPath(sm.storePath, id)
		stored, clean, err := readSessionHistoryFile(path)
		if err != nil {
			slog.Error("session: failed to read history", "path", path, "error", err)
		}
		s.History = stored
		s.histSaved = len(stored)
		s.histRewrite = !clean
		if len(inline) == 0 {
			continue
		}
		// An older bridge may have run again after a migration and written new entries inline:
		// keep what the file has and add only the inline entries newer than its last one.
		add := inline
		if n := len(stored); n > 0 {
			last := stored[n-1].Timestamp
			add = nil
			for _, e := range inline {
				if e.Timestamp.After(last) {
					add = append(add, e)
				}
			}
		}
		s.History = append(s.History, add...)
		moved += len(add)
		s.flushHistoryLocked(sm.storePath, id)
	}
	if migrated {
		slog.Info("session: history moved to per-session files", "dir", SessionHistoryDir(sm.storePath), "entries", moved)
	}
	return migrated
}
