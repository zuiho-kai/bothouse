package core

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The lead's task board (contrib/gate/board.py, `board add/update/done/pause`) lives in
// <team_status_dir>/board.jsonl, one JSON object per line. The native team board renders the
// open items of each chat as one more section, so the item list shows on every platform with a
// BoardPoster and the script no longer posts its own pinned card with a platform token (#597 K9).
const teamTaskBoardFile = "board.jsonl"

type teamTaskBoardItem struct {
	ID       int    `json:"id"`
	What     string `json:"what"`
	Status   string `json:"status"`
	Who      string `json:"who"`
	At       string `json:"at"`
	Next     string `json:"next"`
	Paused   string `json:"paused"`
	PauseWhy string `json:"pause_why"`
	// SK: the chat the item was added in ("<platform>:<id>"); for a handoff, the workspace.
	SK string `json:"sk"`
	// Chat: for a handoff, the chat it came from; the item also shows on that chat's board.
	Chat string `json:"chat"`
}

// chats: the chats this item belongs on.
func (it teamTaskBoardItem) chats() []string {
	var out []string
	if it.SK != "" {
		out = append(out, chatOf(it.SK))
	}
	if it.Chat != "" && (len(out) == 0 || chatOf(it.Chat) != out[0]) {
		out = append(out, chatOf(it.Chat))
	}
	return out
}

// readTeamTaskBoard loads the open items of <dir>/board.jsonl; a missing file or bad lines are skipped.
func readTeamTaskBoard(dir string) []teamTaskBoardItem {
	if dir == "" {
		return nil
	}
	f, err := os.Open(filepath.Join(dir, teamTaskBoardFile))
	if err != nil {
		return nil
	}
	defer f.Close()
	var items []teamTaskBoardItem
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, backfillMaxTotalRune*4) // a line is one item; same bound as the backfill text
	for sc.Scan() {
		var it teamTaskBoardItem
		if json.Unmarshal(sc.Bytes(), &it) == nil && it.ID > 0 {
			items = append(items, it)
		}
	}
	return items
}

// boardLabel: one line, no links or mentions (taskIndexLabel), not shortened.
func boardLabel(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return taskIndexLabel(s, len([]rune(s)))
}

// renderTeamTaskBoard: the task-board section for chat, or "" when it has no items there.
// Running items first, then paused ones, in board order (same blocks as board.py card_text).
func renderTeamTaskBoard(items []teamTaskBoardItem, chat string) string {
	var live, held []string
	for _, it := range items {
		in := false
		for _, c := range it.chats() {
			in = in || c == chat
		}
		if !in {
			continue
		}
		line := fmt.Sprintf("#%d %s｜%s｜%s｜%s", it.ID, boardLabel(it.What), boardLabel(it.Who), boardLabel(it.Status), boardLabel(it.At))
		if it.Paused != "" {
			if it.PauseWhy != "" {
				line += "｜暂停：" + boardLabel(it.PauseWhy)
			}
			held = append(held, line)
			continue
		}
		if it.Next != "" {
			line += "｜下次看 " + boardLabel(it.Next)
		}
		live = append(live, line)
	}
	if len(live)+len(held) == 0 {
		return ""
	}
	out := "**任务板**\n" + strings.Join(live, "\n")
	if len(held) > 0 {
		out += "\n**暂停**\n" + strings.Join(held, "\n")
	}
	return strings.TrimRight(out, "\n")
}

// withTeamTaskBoard appends the task-board section to a board and keeps the whole within one
// Discord post (backfillMaxMsgRunes, the same platform limit board.py's card used).
func withTeamTaskBoard(board, section string) string {
	if section == "" {
		return board
	}
	out := []rune(board + "\n\n" + section)
	if len(out) > backfillMaxMsgRunes {
		out = append(out[:backfillMaxMsgRunes-1], '…')
	}
	return string(out)
}
