package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// The bridge's one way to change a row of the task board file (board.jsonl, one JSON object per
// line). Every bridge-side change of a row goes through updateBoardRow: the watch's progress
// stamp (writeBoardProgress) and the quota takeover's owner change (reassignQuotaBoard). The
// second used to be a Python script embedded in the Go source and run with `python3 -c`, with
// its own fcntl lock and its own temp file name, so the takeover failed on Windows and on a
// machine without python3 (#1627).

// errBoardRowMissing: the board has no row with the id.
var errBoardRowMissing = errors.New("board item missing")

// updateBoardRow changes row id of the board in dir: it takes the board lock (the one board.py
// takes, lockBoardFile), reads the file, hands the row's fields to change, and when change
// reports a change writes the file back whole (tmp + rename, as board.py _write does). Rows
// other than the touched one keep their exact bytes; the touched row is re-encoded, so its key
// order and escaping can shift once. change returning an error writes nothing. A missing board
// file is an error; a board without the row is errBoardRowMissing.
func updateBoardRow(dir string, id int, change func(row map[string]json.RawMessage) (bool, error)) (bool, error) {
	path := filepath.Join(dir, teamTaskBoardFile)
	if _, err := os.Stat(path); err != nil {
		return false, err
	}
	unlock, err := lockBoardFile(filepath.Join(dir, "board.lock"))
	if err != nil {
		return false, err
	}
	defer unlock()
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	lines := strings.Split(string(data), "\n")
	found, changed := false, false
	for i, ln := range lines {
		if strings.TrimSpace(ln) == "" {
			continue
		}
		var row map[string]json.RawMessage
		if json.Unmarshal([]byte(ln), &row) != nil {
			continue
		}
		var got int
		if json.Unmarshal(row["id"], &got) != nil || got != id {
			continue
		}
		found = true
		ok, err := change(row)
		if err != nil {
			return false, err
		}
		if !ok {
			continue
		}
		out, err := json.Marshal(row)
		if err != nil {
			return false, err
		}
		lines[i], changed = string(out), true
	}
	if !found {
		return false, errBoardRowMissing
	}
	if !changed {
		return false, nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		return false, err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return false, err
	}
	return true, nil
}

// boardRowString: field name of row as a string ("" when absent or not a string).
func boardRowString(row map[string]json.RawMessage, name string) string {
	var s string
	_ = json.Unmarshal(row[name], &s)
	return s
}

// rawJSON: v as it must appear inside a board row (a marshal error leaves the field unset).
func rawJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}
