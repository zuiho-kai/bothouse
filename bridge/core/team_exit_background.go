package core

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Background for the chat lead's turn on a workspace reply (wakeChatLead): which task it is
// and what the user asked for, so the lead's first sentence can say it (user 2026-10-28
// 「你要有背景，突然间拍脑袋来一句…没背景都忘记要干嘛了」) and an [ask] the user already
// answered is not asked again.

const (
	backgroundWordsLimit = 1500 // runes of the handoff's 用户原话 sections quoted
	userWordsHeading     = "用户原话"
)

// workspaceTaskBackground: the task-board line of board item boardID when the reply named it
// (its headline, team_exit_headline.go), else of the item last bound to workspace session
// wsSession (open board first, then finished items) and the 用户原话 sections of its handoff
// file (the item's where). "" when nothing is recorded.
func (e *Engine) workspaceTaskBackground(wsSession string, boardID int) string {
	dir := e.teamStatusDir()
	if dir == "" || wsSession == "" {
		return ""
	}
	it := e.workspaceBoardItem(wsSession, boardID)
	if it == nil {
		return ""
	}
	line := "任务板 #" + strconv.Itoa(it.ID) + "：" + it.What
	if it.At != "" {
		line += "（" + it.At + " 交到工作区"
		if it.Status != "" {
			line += "，状态：" + it.Status
		}
		line += "）"
	}
	if words := handoffUserWords(it.Where); words != "" {
		line += "\n交接里记的用户原话：\n" + words
	}
	return line
}

// workspaceBoardItem: board item boardID when it exists, else the item last bound to workspace
// session wsSession (open board first, then finished items); nil when none is recorded.
func (e *Engine) workspaceBoardItem(wsSession string, boardID int) *teamTaskBoardItem {
	dir := e.teamStatusDir()
	if dir == "" || wsSession == "" {
		return nil
	}
	if it := e.boardItemByID(boardID); it != nil {
		return it
	}
	key := teamChatKey(wsSession)
	if it := lastBoundItem(readTeamTaskBoard(dir), key); it != nil {
		return it
	}
	return lastBoundItem(readTeamTaskBoardFile(dir, teamTaskBoardDoneFile), key)
}

func lastBoundItem(items []teamTaskBoardItem, key string) *teamTaskBoardItem {
	var last *teamTaskBoardItem
	for i := range items {
		it := &items[i]
		w := it.WS
		if w == "" {
			w = it.WSWas
		}
		if w == "" || teamChatKey(w) != key {
			continue
		}
		if last == nil || it.Bound >= last.Bound {
			last = it
		}
	}
	return last
}

// handoffUserWords: the sections of handoff file path whose heading names 用户原话.
func handoffUserWords(path string) string {
	var out []string
	for _, ln := range strings.Split(handoffSection(path, userWordsHeading), "\n") {
		if strings.TrimSpace(ln) != "" {
			out = append(out, ln)
		}
	}
	return truncateRelay(strings.Join(out, "\n"), backgroundWordsLimit)
}

// handoffSection: the body of every section of handoff file path (ws-handoff's markdown)
// whose heading line contains heading, in file order, blank lines inside kept and the whole
// trimmed. "" when path is not an absolute readable file or has no such section.
func handoffSection(path, heading string) string {
	path = strings.TrimSpace(path)
	if path == "" || !filepath.IsAbs(path) || heading == "" {
		return ""
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var out []string
	in := false
	for _, ln := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(ln, "#") {
			in = strings.Contains(ln, heading)
			continue
		}
		if in {
			out = append(out, strings.TrimRight(ln, " \t\r"))
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// firstParagraph: s up to its first blank line.
func firstParagraph(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "\n\n"); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}
