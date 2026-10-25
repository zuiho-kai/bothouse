package core

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The lead's task board (contrib/gate/board.py, `board add/update/done/pause`) lives in
// <team_status_dir>/board.jsonl, one JSON object per line; finished items go to board-done.jsonl.
// The native team board renders them as one more section of each chat's board, so the item list
// shows on every platform with a BoardPoster and the script no longer posts its own pinned card
// with a platform token (#597 K9). Same blocks as board.py's old card: running (the chat's own
// items, then one block per workspace of the chat), paused, done today.
const (
	teamTaskBoardFile     = "board.jsonl"
	teamTaskBoardDoneFile = "board-done.jsonl"
	// teamTaskBoardDoneRows: done today lists the newest few, the rest as "…另 N 件" (board.py
	// DONE_PER_BLOCK): a day with many done items must not push running ones out of the post.
	teamTaskBoardDoneRows = 3
	// teamTaskBoardNextGrace: a "下次看 HH:MM" is overdue this long after its time with no pending
	// timer for it (board.py NEXT_GRACE: later rounds to the minute, a timer fires up to 59s late).
	teamTaskBoardNextGrace = 120 * time.Second
)

type teamTaskBoardItem struct {
	ID       int    `json:"id"`
	What     string `json:"what"`
	Status   string `json:"status"`
	Who      string `json:"who"`
	At       string `json:"at"`
	Next     string `json:"next"`
	NextTS   int64  `json:"next_ts"` // epoch of Next, written by board.py when set
	Paused   string `json:"paused"`
	PauseWhy string `json:"pause_why"`
	DoneAt   string `json:"done_at"` // board-done.jsonl: "MM-DD HH:MM", local time
	// SK: the chat the item was added in ("<platform>:<id>"); for a handoff, the workspace.
	SK string `json:"sk"`
	// WS: the workspace a handoff item is bound to; dropped when the item leaves it (pause).
	WS string `json:"ws"`
	// Chat: for a handoff, the chat it came from; the item also shows on that chat's board.
	Chat string `json:"chat"`
	// Ch: bare Discord channel ID, the only channel field of items written before sk existed.
	Ch string `json:"ch"`

	// Resolved by placeTeamTaskBoard, not stored.
	own    string // the chat the item is in
	parent string // for an item in a workspace: the chat the workspace belongs to
	wsName string // that workspace's name
}

// readTeamTaskBoardFile loads <dir>/<name>; a missing file or bad lines are skipped.
func readTeamTaskBoardFile(dir, name string) []teamTaskBoardItem {
	if dir == "" {
		return nil
	}
	f, err := os.Open(filepath.Join(dir, name))
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

// readTeamTaskBoard loads the open items of <dir>/board.jsonl.
func readTeamTaskBoard(dir string) []teamTaskBoardItem {
	return readTeamTaskBoardFile(dir, teamTaskBoardFile)
}

// readTeamTaskBoardDoneToday loads the items of <dir>/board-done.jsonl finished today (local date).
func readTeamTaskBoardDoneToday(dir string, now time.Time) []teamTaskBoardItem {
	today := now.Format("01-02")
	var out []teamTaskBoardItem
	for _, it := range readTeamTaskBoardFile(dir, teamTaskBoardDoneFile) {
		if strings.HasPrefix(it.DoneAt, today) {
			out = append(out, it)
		}
	}
	return out
}

// teamTaskBoardPlacer tells where items go: which chat a workspace belongs to and its name.
type teamTaskBoardPlacer struct {
	mainChat   string                            // for items with no chat recorded
	parentOf   func(ws string) (string, bool)    // workspace key → chat key
	workspaces func(chat string) []TeamWorkspace // a chat's workspaces, in order
}

func (e *Engine) teamTaskBoardPlacer() teamTaskBoardPlacer {
	chats := e.teamLeadChats()
	sort.Strings(chats)
	p := teamTaskBoardPlacer{parentOf: e.WorkspaceParent, workspaces: e.TeamWorkspacesOf}
	if len(chats) > 0 {
		p.mainChat = chats[0]
	}
	return p
}

// place resolves own/parent/wsName. Old items: sk, else the bare Discord channel ch; with neither
// the item shows in the main chat instead of being dropped.
func (p teamTaskBoardPlacer) place(it *teamTaskBoardItem) {
	switch {
	case it.WS != "":
		it.own = chatOf(it.WS)
	case it.SK != "":
		it.own = chatOf(it.SK)
	case it.Ch != "":
		it.own = "discord:" + it.Ch
	default:
		it.own = p.mainChat
	}
	if it.Chat != "" && chatOf(it.Chat) != it.own {
		it.parent = chatOf(it.Chat)
	} else if p.parentOf != nil {
		if parent, ok := p.parentOf(it.own); ok {
			it.parent = chatOf(parent)
		}
	}
	if it.parent == "" {
		return
	}
	id := teamChannelID(it.own)
	it.wsName = id
	if p.workspaces != nil {
		for _, w := range p.workspaces(it.parent) {
			if w.ID == id && w.Name != "" {
				it.wsName = w.Name
			}
		}
	}
}

func placeTeamTaskBoard(p teamTaskBoardPlacer, items []teamTaskBoardItem) []teamTaskBoardItem {
	for i := range items {
		p.place(&items[i])
	}
	return items
}

// chats: the chats this item shows on (its own, and the chat its workspace belongs to).
func (it teamTaskBoardItem) chats() []string {
	var out []string
	if it.own != "" {
		out = append(out, it.own)
	}
	if it.parent != "" && it.parent != it.own {
		out = append(out, it.parent)
	}
	return out
}

// boardLabel: one line, no links or mentions (taskIndexLabel), not shortened.
func boardLabel(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return taskIndexLabel(s, len([]rune(s)))
}

// teamTaskBoardNextOverdue: the "下次看" time has passed and no pending timer is still due for it
// (later sets the timer with --desc <what>). pending nil = timers unknown: never overdue.
func teamTaskBoardNextOverdue(it teamTaskBoardItem, now time.Time, pending []*TimerJob) bool {
	if it.Next == "" || pending == nil {
		return false
	}
	if it.NextTS > 0 && time.Unix(it.NextTS, 0).After(now.Add(-teamTaskBoardNextGrace)) {
		return false
	}
	h, m, ok := strings.Cut(it.Next, ":")
	hh, err1 := strconv.Atoi(h)
	mm, err2 := strconv.Atoi(m)
	if !ok || err1 != nil || err2 != nil {
		return false // not an HH:MM: show as written
	}
	for _, j := range pending {
		if j.Description != it.What {
			continue
		}
		t := j.ScheduledAt.Local()
		d := (t.Hour()*60 + t.Minute() - hh*60 - mm) % 1440
		if d < 0 {
			d = -d
		}
		if min(d, 1440-d) <= int(teamTaskBoardNextGrace/time.Minute) {
			return false
		}
	}
	return true
}

// renderTeamTaskBoard: the task-board section for chat, or "" when it has nothing there.
// Items must be placed (placeTeamTaskBoard). Running: the chat's own items first, then one block
// per workspace of the chat; then paused; then done today (workspace items marked "<name>·").
func renderTeamTaskBoard(items, done []teamTaskBoardItem, chat string, now time.Time, pending []*TimerJob) string {
	in := func(it teamTaskBoardItem) bool {
		for _, c := range it.chats() {
			if c == chat {
				return true
			}
		}
		return false
	}
	row := func(it teamTaskBoardItem) string {
		line := fmt.Sprintf("#%d %s｜%s｜%s｜%s", it.ID, boardLabel(it.What), boardLabel(it.Who), boardLabel(it.Status), boardLabel(it.At))
		if it.Paused != "" {
			if it.PauseWhy != "" {
				line += "｜暂停：" + boardLabel(it.PauseWhy)
			}
			return line
		}
		if it.Next != "" {
			line += "｜下次看 " + boardLabel(it.Next)
			if teamTaskBoardNextOverdue(it, now, pending) {
				line += "（已过）"
			}
		}
		return line
	}
	var own, held []string
	var wsOrder []string
	wsRows := map[string][]string{}
	for _, it := range items {
		if !in(it) {
			continue
		}
		switch {
		case it.Paused != "":
			held = append(held, row(it))
		case it.parent == chat && it.own != chat:
			if _, ok := wsRows[it.wsName]; !ok {
				wsOrder = append(wsOrder, it.wsName)
			}
			wsRows[it.wsName] = append(wsRows[it.wsName], row(it))
		default:
			own = append(own, row(it))
		}
	}
	// Done today: the same thing done in several rounds shows once with a count; newest first.
	type doneRow struct {
		key  string
		n    int
		last int
	}
	var doneRows []*doneRow
	seen := map[string]*doneRow{}
	for k, it := range done {
		if !in(it) {
			continue
		}
		ws := ""
		if it.parent == chat && it.own != chat {
			ws = boardLabel(it.wsName) + "·"
		}
		key := "- " + ws + boardLabel(it.Who) + "：" + boardLabel(it.What)
		if r := seen[key]; r != nil {
			r.n, r.last = r.n+1, k
			continue
		}
		r := &doneRow{key: key, n: 1, last: k}
		seen[key] = r
		doneRows = append(doneRows, r)
	}
	if len(own)+len(wsOrder)+len(held)+len(doneRows) == 0 {
		return ""
	}
	sort.SliceStable(doneRows, func(i, j int) bool { return doneRows[i].last > doneRows[j].last })
	lines := []string{"**任务板**"}
	lines = append(lines, own...)
	for _, name := range wsOrder {
		lines = append(lines, "", "**"+boardLabel(name)+"**")
		lines = append(lines, wsRows[name]...)
	}
	if len(own)+len(wsOrder) == 0 {
		lines = append(lines, "现在没有进行中的事。")
	}
	if len(held) > 0 {
		lines = append(lines, "", "**暂停**")
		lines = append(lines, held...)
	}
	if len(doneRows) > 0 {
		lines = append(lines, "", "**今天做完**")
		for i, r := range doneRows {
			if i == teamTaskBoardDoneRows {
				lines = append(lines, fmt.Sprintf("- …另 %d 件", len(doneRows)-i))
				break
			}
			if r.n > 1 {
				lines = append(lines, fmt.Sprintf("%s（%d 趟）", r.key, r.n))
			} else {
				lines = append(lines, r.key)
			}
		}
	}
	return strings.Join(lines, "\n")
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
