package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// What the user approved (#1904, user 11-23: 「你点过头的东西记下来，新会话也自动带上，不许改动」).
// contrib/gate/deliver.py (`board approve`) writes one record per product task,
// <task board dir>/deliver/<id>.json; the bridge only reads them. Each agent context gets the approvals of
// the tasks still on the open board that belong to its chat (a workspace: the tasks bound to it) once, before
// its first turn, and again when the text changes. Unlike the life page, a workspace turn gets it too: the
// workspace is where the approved product is changed. The user's words and the locked parts are never cut.

const (
	deliverApprovedHead = "（用户认可过的成品，"
	deliverApprovedEnd  = "（认可记录到此）"
	deliverApprovedRule = "之后的改动不得碰上面不许动的部分；确实要动，先问用户。"
)

// deliverRecord is the part of deliver/<id>.json the injected block shows (the format is fixed by the
// write side; stage, product, refs and compares are not read here).
type deliverRecord struct {
	ID        any               `json:"id"` // "1904"; a bare number is accepted too
	Title     string            `json:"title"`
	Chat      string            `json:"chat"` // "<platform>:<channel id>", as on the board item
	Approvals []deliverApproval `json:"approvals"`
}

type deliverApproval struct {
	File   string   `json:"file"`
	Quote  string   `json:"quote"`
	At     string   `json:"at"`
	Locked []string `json:"locked"`
}

// deliverDir is <task board dir>/deliver. The task board dir is the one board.py resolves (_board_dir):
// the team status dir this engine runs with, which roleSessionEnv also hands to board.py as BOARD_DIR, or
// <data dir>/team when no team dir is set.
func (e *Engine) deliverDir() string {
	if e == nil {
		return ""
	}
	if e.team != nil && e.team.dir != "" {
		return filepath.Join(filepath.Clean(e.team.dir), "deliver")
	}
	if e.dataDir == "" {
		return ""
	}
	return filepath.Join(e.dataDir, "team", "deliver")
}

// deliverInChat: the record belongs to chat ("<platform>:<id>"): it names that chat itself, or its board
// item was added there, is bound to it (a workspace) or was handed over from it (board.py in_chat).
func deliverInChat(recChat string, it teamTaskBoardItem, chat string) bool {
	for _, c := range []string{recChat, it.WS, it.SK, it.Chat, it.Ch} {
		if c = strings.TrimSpace(c); c != "" && teamChatKey(c) == chat {
			return true
		}
	}
	return false
}

// deliverApprovedText renders the approvals of chat's open tasks ("" when there are none).
func (e *Engine) deliverApprovedText(sessionKey string) string {
	dir := e.deliverDir()
	if dir == "" || sessionKey == "" {
		return ""
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	if len(files) == 0 {
		return ""
	}
	open := map[int]teamTaskBoardItem{}
	for _, it := range readTeamTaskBoard(filepath.Dir(dir)) {
		open[it.ID] = it
	}
	if len(open) == 0 {
		return ""
	}
	chat := teamChatKey(sessionKey)
	type entry struct {
		id   int
		text string
	}
	var entries []entry
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			slog.Warn("deliver approved: read failed", "path", f, "error", err)
			continue
		}
		var rec deliverRecord
		if err := json.Unmarshal(raw, &rec); err != nil {
			slog.Warn("deliver approved: bad record", "path", f, "error", err)
			continue
		}
		if len(rec.Approvals) == 0 {
			continue
		}
		id := deliverRecordID(rec.ID, f)
		it, ok := open[id]
		if !ok || !deliverInChat(rec.Chat, it, chat) {
			continue
		}
		title := strings.TrimSpace(rec.Title)
		if title == "" {
			title = teamTaskBoardShort(it)
		}
		var b strings.Builder
		fmt.Fprintf(&b, "#%d %s", id, title)
		for i, a := range rec.Approvals {
			which := "认可的是"
			if len(rec.Approvals) > 1 {
				which = fmt.Sprintf("第 %d 次认可的是", i+1)
			}
			fmt.Fprintf(&b, "\n· %s：%s", which, strings.TrimSpace(a.File))
			if t, err := time.Parse(time.RFC3339, strings.TrimSpace(a.At)); err == nil {
				fmt.Fprintf(&b, "（%s）", stamp(t))
			}
			fmt.Fprintf(&b, "\n· 用户原话：「%s」", strings.TrimSpace(a.Quote))
			var locked []string
			for _, l := range a.Locked {
				if l = strings.TrimSpace(l); l != "" {
					locked = append(locked, l)
				}
			}
			if len(locked) == 0 {
				b.WriteString("\n· 不许动：没单列，认可的这一份整份不改")
			} else {
				fmt.Fprintf(&b, "\n· 不许动：%s", strings.Join(locked, "；"))
			}
		}
		entries = append(entries, entry{id, b.String()})
	}
	if len(entries) == 0 {
		return ""
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].id < entries[j].id })
	parts := make([]string, len(entries))
	for i, en := range entries {
		parts[i] = en.text
	}
	return deliverApprovedHead + "系统在每个新会话开头附上，记录变了会重发；不用回应）\n" +
		strings.Join(parts, "\n") + "\n" + deliverApprovedRule + "\n" + deliverApprovedEnd
}

// deliverRecordID: the board id of a record, from its id field or, when that is missing, its file name.
func deliverRecordID(v any, path string) int {
	s := ""
	switch x := v.(type) {
	case string:
		s = x
	case float64:
		s = strconv.Itoa(int(x))
	}
	s = strings.TrimPrefix(strings.TrimSpace(s), "#")
	if s == "" {
		s = strings.TrimSuffix(filepath.Base(path), ".json")
	}
	n, _ := strconv.Atoi(s)
	return n
}

// deliverApprovedBlock: the approvals for this turn. gate.go's add sends it once per agent context
// and again when its text changes (injectBlock, inject.go).
func (e *Engine) deliverApprovedBlock(session *Session, sessionKey string) string {
	if session == nil {
		return ""
	}
	return e.deliverApprovedText(sessionKey)
}
