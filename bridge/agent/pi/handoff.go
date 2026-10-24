package pi

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.SessionHandoffReader = (*Agent)(nil)

// ReadSessionHandoff reads what a fresh context needs from a pi session's
// .jsonl file along the current branch: the last model reply's time and
// prompt token size, the newest compaction summary, and the user/assistant
// dialogue the model still sees (kept entries plus those after it).
func (a *Agent) ReadSessionHandoff(sessionID string) (*core.SessionHandoff, error) {
	a.mu.Lock()
	workDir := a.workDir
	a.mu.Unlock()

	var path string
	if filepath.IsAbs(sessionID) && strings.HasSuffix(sessionID, ".jsonl") {
		if _, err := os.Stat(sessionID); err == nil {
			path = sessionID
		}
	}
	if path == "" {
		sessDir := piSessionDir(workDir)
		if sessDir != "" {
			path = findSessionFile(sessDir, sessionID)
		}
	}
	if path == "" {
		return nil, fmt.Errorf("pi: session file not found for %s", sessionID)
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("pi: open session file: %w", err)
	}
	defer f.Close()

	h, err := parsePiHandoff(f)
	if err != nil {
		return nil, fmt.Errorf("pi: read session file: %w", err)
	}
	h.Path = path
	return h, nil
}

// piEntry is one line of a pi session file (pi-coding-agent
// session-manager.d.ts SessionEntryBase and its kinds). The entry timestamp
// is an ISO string; message.timestamp is a number in ms (pi-ai types.d.ts).
type piEntry struct {
	Type             string          `json:"type"` // "session" | "message" | "compaction" | ...
	ID               string          `json:"id"`
	ParentID         *string         `json:"parentId"`
	Timestamp        string          `json:"timestamp"`
	Summary          string          `json:"summary"`          // compaction
	FirstKeptEntryID string          `json:"firstKeptEntryId"` // compaction
	Message          *piMessageEntry `json:"message"`          // message
}

type piMessageEntry struct {
	Role      string          `json:"role"` // "user" | "assistant" | "toolResult" | "system" | ...
	Content   json.RawMessage `json:"content"`
	Usage     *piUsageEntry   `json:"usage"`
	Timestamp float64         `json:"timestamp"` // ms since epoch
}

type piUsageEntry struct {
	Input      int `json:"input"`
	Output     int `json:"output"`
	CacheRead  int `json:"cacheRead"`
	CacheWrite int `json:"cacheWrite"`
}

func (e *piEntry) time() time.Time {
	if ts, err := time.Parse(time.RFC3339Nano, e.Timestamp); err == nil {
		return ts
	}
	if e.Message != nil && e.Message.Timestamp > 0 {
		return time.UnixMilli(int64(e.Message.Timestamp)).UTC()
	}
	return time.Time{}
}

func parsePiHandoff(r io.Reader) (*core.SessionHandoff, error) {
	entries, err := readPiEntries(r)
	if err != nil {
		return nil, err
	}
	var h core.SessionHandoff
	ctx, after := piContextEntries(entries)
	for i, e := range ctx {
		switch e.Type {
		case "compaction":
			h.CompactSummary = e.Summary
			h.CompactedAt = e.time()
		case "message":
			// Usage on the kept entries is the pre-compaction prompt size; pi
			// records no post-compaction size, so only replies after the
			// compaction set it (0 until then).
			addPiMessage(&h, e, i >= after)
		}
	}
	return &h, nil
}

// readPiEntries reads every tree entry; tool outputs can be megabytes on one
// line, so lines have no size limit.
func readPiEntries(r io.Reader) ([]*piEntry, error) {
	var entries []*piEntry
	br := bufio.NewReader(r)
	for {
		raw, err := br.ReadBytes('\n')
		if len(raw) > 0 {
			var e piEntry
			if json.Unmarshal(raw, &e) == nil && e.Type != "session" && e.ID != "" {
				entries = append(entries, &e)
			}
		}
		if errors.Is(err, io.EOF) {
			return entries, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// piContextEntries mirrors pi's buildContextEntries (session-manager.js):
// walk from the leaf (the last entry) to the root, and when the path has a
// compaction, keep the newest one, the entries from its firstKeptEntryId up
// to it, and everything after it. The compaction itself comes first.
//
// after is the index in the result where entries newer than the compaction
// start (0 when there is no compaction).
func piContextEntries(entries []*piEntry) (ctx []*piEntry, after int) {
	if len(entries) == 0 {
		return nil, 0
	}
	byID := make(map[string]*piEntry, len(entries))
	for _, e := range entries {
		byID[e.ID] = e
	}
	var path []*piEntry
	seen := map[string]bool{}
	for cur := entries[len(entries)-1]; cur != nil && !seen[cur.ID]; {
		seen[cur.ID] = true
		path = append(path, cur)
		if cur.ParentID == nil {
			break
		}
		cur = byID[*cur.ParentID]
	}
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	ci := -1
	for i, e := range path {
		if e.Type == "compaction" {
			ci = i
		}
	}
	if ci < 0 {
		return path, 0
	}
	out := []*piEntry{path[ci]}
	kept := false
	for _, e := range path[:ci] {
		if e.ID == path[ci].FirstKeptEntryID {
			kept = true
		}
		if kept && !(e.Type == "message" && e.Message != nil && e.Message.Role == "system") {
			out = append(out, e)
		}
	}
	return append(out, path[ci+1:]...), len(out)
}

func addPiMessage(h *core.SessionHandoff, e *piEntry, countUsage bool) {
	msg := e.Message
	if msg == nil {
		return
	}
	switch msg.Role {
	case "user", "toolResult":
		// Images in user messages and tool results are re-sent every request.
		h.ImageBytes += piImageBytes(msg.Content)
	}
	ts := e.time()
	if msg.Role == "assistant" {
		// Every model reply counts, even one holding only tool calls.
		if u := msg.Usage; countUsage && u != nil && u.Input+u.CacheRead+u.CacheWrite > 0 {
			h.LastActivity = ts
			h.ContextTokens = u.Input + u.CacheRead + u.CacheWrite
		}
	}
	if msg.Role != "user" && msg.Role != "assistant" {
		return
	}
	if text := extractPiContentText(msg.Content); text != "" {
		h.Tail = append(h.Tail, core.HistoryEntry{Role: msg.Role, Content: text, Timestamp: ts})
	}
}

func piImageBytes(raw json.RawMessage) int {
	var arr []struct {
		Type string `json:"type"`
		Data string `json:"data"`
	}
	if json.Unmarshal(raw, &arr) != nil {
		return 0
	}
	n := 0
	for _, c := range arr {
		if c.Type == "image" {
			n += len(c.Data)
		}
	}
	return n
}

// extractPiContentText joins the text blocks of a message (thinking and tool
// calls are skipped). Unlike readPiHistory, which shows the first text block
// of array content, the handoff keeps all text and also reads plain-string
// user content, so the fresh context sees the whole visible dialogue.
func extractPiContentText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var str string
	if err := json.Unmarshal(raw, &str); err == nil {
		return str
	}
	var arr []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &arr); err == nil {
		var parts []string
		for _, part := range arr {
			if part.Type == "text" && part.Text != "" {
				parts = append(parts, part.Text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}
