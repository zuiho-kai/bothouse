package core

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// The lead's task board (contrib/gate/board.py, `board add/update/done/pause`) lives in
// <team_status_dir>/board.jsonl, one JSON object per line; finished items go to board-done.jsonl.
// The native team board renders them as one more section of each chat's board, so the item list
// shows on every platform with a BoardPoster and the script no longer posts its own pinned card
// with a platform token (#597 K9). Only open items are shown (four states, renderTeamTaskBoard);
// board-done.jsonl is read for lookups of finished items, not for the board.
const (
	teamTaskBoardFile     = "board.jsonl"
	teamTaskBoardDoneFile = "board-done.jsonl"
)

type teamTaskBoardItem struct {
	ID       int    `json:"id"`
	What     string `json:"what"`
	Short    string `json:"short"` // board.py add --short / short_of: the name the board shows
	Status   string `json:"status"`
	Who      string `json:"who"`
	Where    string `json:"where"`
	At       string `json:"at"`
	Next     string `json:"next"`
	NextTS   int64  `json:"next_ts"` // epoch of Next, written by board.py when set
	Paused   string `json:"paused"`
	PauseWhy string `json:"pause_why"`
	DoneAt   string `json:"done_at"` // board-done.jsonl: "MM-DD HH:MM", local time
	// AutoPruned: board.py auto_prune moved this paused item to board-done.jsonl (the reason); not
	// work done, so it stays out of "done today" (board resume brings it back).
	AutoPruned string `json:"auto_pruned"`
	// SK: the chat the item was added in ("<platform>:<id>"); for a handoff, the workspace.
	SK string `json:"sk"`
	// WS: the workspace a handoff item is bound to; dropped when the item leaves it (pause).
	WS string `json:"ws"`
	// WSWas: the workspace a paused handoff item was bound to (board.py pause moves WS here).
	WSWas string `json:"ws_was"`
	// Bound: when the item was bound to WS (RFC 3339), just after the bridge recorded that handoff.
	Bound string `json:"bound"`
	// Chat: for a handoff, the chat it came from; the item also shows on that chat's board.
	Chat string `json:"chat"`
	// Ch: bare Discord channel ID, the only channel field of items written before sk existed.
	Ch string `json:"ch"`
	// ProgressAt: epoch of the workspace's last ws-up report (board.py progress); 0 = none yet.
	ProgressAt float64 `json:"progress_at"`

	// Resolved by placeTeamTaskBoard, not stored.
	own    string // the chat the item is in
	parent string // for an item in a workspace: the chat the workspace belongs to
	wsName string // that workspace's name
	// wsEnded: WS has stopped working on the item's handoff (finished or paused there,
	// TeamHandoffEnded); the item waits for the lead (board done / resume) and is not live work.
	wsEnded bool
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

// teamTaskBoardWaitUser: a pause reason that waits on the user ("等用户", "等待用户", ws-up --ask's
// "等待用户答复"). Same pattern as board.py WAIT_USER_RE (those items are kept by auto_prune's idle
// rule); change both together.
var teamTaskBoardWaitUser = regexp.MustCompile(`等待?用户`)

// teamTaskBoardWaitHours: whole hours a paused item has waited on the user, 0 below one hour or
// when it does not wait on the user. Paused is "MM-DD HH:MM" local without a year: this year,
// or last year when that is more than a day ahead (board.py _done_time).
func teamTaskBoardWaitHours(it teamTaskBoardItem, now time.Time) int {
	if it.Paused == "" || !teamTaskBoardWaitUser.MatchString(it.PauseWhy) {
		return 0
	}
	at, ok := teamTaskBoardLocal(it.Paused, now)
	if !ok {
		return 0
	}
	return int(now.Sub(at) / time.Hour)
}

// teamTaskBoardPlacer tells where items go: which chat a workspace belongs to and its name.
type teamTaskBoardPlacer struct {
	mainChat string                         // for items with no chat recorded; "" = not shown
	parentOf func(ws string) (string, bool) // workspace key → chat key
	wsName   func(ws string) string         // a workspace's name (TeamWorkspaceName); "" = not recorded
	// handoffEnded: TeamHandoffEnded (workspace, chat that handed off, bound); nil = unknown.
	handoffEnded func(ws, chat string, bound time.Time) bool
}

func (e *Engine) teamTaskBoardPlacer() teamTaskBoardPlacer {
	return teamTaskBoardPlacer{mainChat: teamMainChat(e.dataDir), parentOf: e.WorkspaceParent, wsName: e.TeamWorkspaceName, handoffEnded: e.TeamHandoffEnded}
}

// teamMainChat: the main chat channel the setup wizard bound the roles to (conest-setup.json
// channel_id / feishu_chat_id, the same source as the wiki cron session); "" when none is
// recorded (cloud_web has no fixed channel). Not a pick among the lead's chats: that list holds
// workspaces and long-idle channels too (PR #377 review).
func teamMainChat(dataDir string) string {
	if dataDir == "" {
		return ""
	}
	st := LoadSetupState(dataDir)
	return wizardSessionKey(st.Platform, st.ChannelID, st.FeishuChatID)
}

// teamTaskBoardUnplaced: item ids already logged as not shown (no chat recorded, no main chat),
// so the 10s board loop logs each once.
var teamTaskBoardUnplaced sync.Map

// place resolves own/parent/wsName. Old items: sk, else the bare Discord channel ch; with neither
// the item shows in the main chat, or nowhere (logged once) when no main chat is recorded.
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
		if it.own == "" {
			if _, seen := teamTaskBoardUnplaced.LoadOrStore(it.ID, true); !seen {
				slog.Warn("team task board: item has no chat and no main chat is recorded; not shown", "id", it.ID, "what", it.What)
			}
			return
		}
	}
	chat := it.Chat
	if chat != "" && !strings.Contains(chat, ":") {
		chat = "discord:" + chat // board.py writes the bare Discord channel ID, like ch
	}
	if it.WS != "" && p.handoffEnded != nil {
		bound, _ := time.Parse(time.RFC3339Nano, it.Bound) // unparsable: zero, the chat's newest handoff
		it.wsEnded = p.handoffEnded(it.WS, chat, bound)
	}
	if chat != "" && chatOf(chat) != it.own {
		it.parent = chatOf(chat)
	} else if p.parentOf != nil {
		if parent, ok := p.parentOf(it.own); ok {
			it.parent = chatOf(parent)
		}
	}
	if it.parent == "" {
		return
	}
	// The name, also after the workspace was released (its chat no longer owns it; #597 G36: the
	// done row showed the internal id 「room-2·」 then).
	it.wsName = teamChannelID(it.own)
	if p.wsName != nil {
		if name := p.wsName(it.own); name != "" {
			it.wsName = name
		}
	}
}

func placeTeamTaskBoard(p teamTaskBoardPlacer, items []teamTaskBoardItem) []teamTaskBoardItem {
	for i := range items {
		p.place(&items[i])
	}
	return items
}

// shownIn: the item is on chat's board.
func (it teamTaskBoardItem) shownIn(chat string) bool {
	for _, c := range it.chats() {
		if c == chat {
			return true
		}
	}
	return false
}

// teamTaskBoardLive: chat's task-board section has live work: an open item that is not paused and,
// for a handoff item, whose workspace is still on it (not wsEnded). The board card's state uses it,
// from the same placed items the section is rendered from.
func teamTaskBoardLive(items []teamTaskBoardItem, chat string) bool {
	for _, it := range items {
		if it.shownIn(chat) && it.Paused == "" && !it.wsEnded {
			return true
		}
	}
	return false
}

// chats: the chats this item shows on (its own, and the chat its workspace belongs to). Test
// work shows only in its own chat, not on the board of the chat it came from (core/test_noise.go).
func (it teamTaskBoardItem) chats() []string {
	var out []string
	if it.own != "" {
		out = append(out, it.own)
	}
	if it.parent != "" && it.parent != it.own && !it.isTest() {
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

// shortLabel: boardLabel cut to max runes with "…"; max < 0 = not cut, 0 = just "…".
func shortLabel(s string, max int) string {
	l := boardLabel(s)
	if max < 0 || l == "-" {
		return l
	}
	r := []rune(l)
	if len(r) <= max {
		return l
	}
	return string(r[:max]) + "…"
}

// The board shows each item in one of four states (user, 2026-10-28: 「就这样看着乱糟糟的」 — the
// free-text status went on every row): 卡住 first (user, 2026-10-25: 卡住要顶上，不能自动暂停藏起来),
// then 在做, then 等你 with a short reason taken from the item's own words; other paused items are
// only counted, and done ones are left off. The full text stays in the board command.
type teamTaskBoardState int

const (
	teamTaskStuck   teamTaskBoardState = iota // handed to a workspace, nobody reported in an hour
	teamTaskRunning                           // in work
	teamTaskWaiting                           // waits on the user (看片/拍板/答复)
	teamTaskPaused                            // paused for another reason: counted only
	teamTaskHidden                            // finished, or its workspace has ended the handoff
)

const (
	// teamTaskBoardStuckAfter: a handoff with no ws-up report this long after it was bound is 卡住.
	// Source: the plan the user approved 2026-10-28 (「交出去一小时没人接」), same hour as board.py STALE_AFTER.
	teamTaskBoardStuckAfter = time.Hour
	// teamTaskBoardReasonRunes: the reason after 等你/卡住. Source: the approved plan, 「短理由（≤20 字）」.
	teamTaskBoardReasonRunes = 20
	// teamTaskBoardShortRunes: an item's name. Source: the approved plan, 「短名（≤10 字）」 (board.py SHORT_RUNES).
	teamTaskBoardShortRunes = 10
)

var (
	// Same as board.py _SHORT_TAG/_SHORT_PREFIX (short_of); change both together.
	teamTaskBoardShortTag    = regexp.MustCompile(`[（(]用户点名[)）]`)
	teamTaskBoardShortPrefix = regexp.MustCompile(`^\s*(?:用户点名(?:「[^」]*」|（[^）]*）|\s*#\d+\s*\S{0,3})?[：:]|用户点名\s*|事故\s*#\d+[^：:]{0,8}[：:]|#\d+[^：:]{0,10}[：:])\s*`)
	teamTaskBoardShortCut    = regexp.MustCompile(`[：:，,；;（(]`)
	// teamTaskBoardWaitTag: the 「等用户[看片]」-style head of a waiting item's text, dropped from its reason.
	teamTaskBoardWaitTag = regexp.MustCompile(`^\s*(?:等待?用户(?:答复|确认|拍板|看片|定)?|待用户(?:定)?)(?:[\[［][^\]］]*[\]］])?\s*[：:，,]?\s*`)
)

// teamTaskBoardShort: the item's name on the board: board.py's short, else its what without
// 「用户点名：」「#N 续：」 heads, cut at an early colon or to teamTaskBoardShortRunes.
func teamTaskBoardShort(it teamTaskBoardItem) string {
	if s := strings.TrimSpace(it.Short); s != "" {
		return boardLabel(s)
	}
	s := strings.TrimSpace(teamTaskBoardShortTag.ReplaceAllString(boardLabel(it.What), ""))
	for {
		loc := teamTaskBoardShortPrefix.FindStringIndex(s)
		if loc == nil || loc[1] == 0 || loc[1] >= len(s) {
			break
		}
		s = s[loc[1]:]
	}
	if loc := teamTaskBoardShortCut.FindStringIndex(s); loc != nil {
		if n := len([]rune(s[:loc[0]])); n >= 2 && n <= teamTaskBoardShortRunes {
			return strings.TrimSpace(s[:loc[0]])
		}
	}
	r := []rune(s)
	if len(r) <= teamTaskBoardShortRunes {
		return s
	}
	return strings.TrimSpace(string(r[:teamTaskBoardShortRunes])) + "…"
}

// teamTaskBoardLocal parses a board.py "MM-DD HH:MM" local time without a year: this year, or last
// year when that is more than a day ahead (board.py _done_time).
func teamTaskBoardLocal(s string, now time.Time) (time.Time, bool) {
	at, err := time.ParseInLocation("2006-01-02 15:04", fmt.Sprintf("%d-%s", now.Year(), s), now.Location())
	if err != nil {
		return time.Time{}, false
	}
	if at.After(now.Add(24 * time.Hour)) {
		at = at.AddDate(-1, 0, 0)
	}
	return at, true
}

// teamTaskBoardLastActive: the newest of the item's ws-up report, last board update and binding.
func teamTaskBoardLastActive(it teamTaskBoardItem, now time.Time) time.Time {
	var last time.Time
	if it.ProgressAt > 0 {
		last = time.Unix(int64(it.ProgressAt), 0)
	}
	if at, ok := teamTaskBoardLocal(it.At, now); ok && at.After(last) {
		last = at
	}
	if b, err := time.Parse(time.RFC3339Nano, it.Bound); err == nil && b.After(last) {
		last = b
	}
	return last
}

// teamTaskBoardAgo: 「刚刚」「N 分钟前」「N 小时前」「N 天前」 (hours up to two days, then days).
func teamTaskBoardAgo(t, now time.Time) string {
	d := now.Sub(t)
	switch {
	case t.IsZero():
		return ""
	case d < time.Minute:
		return "刚刚"
	case d < time.Hour:
		return fmt.Sprintf("%d 分钟前", int(d/time.Minute))
	case d < 2*24*time.Hour:
		return fmt.Sprintf("%d 小时前", int(d/time.Hour))
	}
	return fmt.Sprintf("%d 天前", int(d/(24*time.Hour)))
}

// teamTaskBoardReason: the start of the item's own words, ≤ teamTaskBoardReasonRunes, with a
// leading 「等用户[看片]」 dropped; "" when nothing is left.
func teamTaskBoardReason(texts ...string) string {
	for _, t := range texts {
		t = strings.TrimSpace(teamTaskBoardWaitTag.ReplaceAllString(boardLabel(t), ""))
		if t == "" || t == "-" {
			continue
		}
		return shortLabel(t, teamTaskBoardReasonRunes)
	}
	return ""
}

// teamTaskBoardStateOf: the item's state and the text after it (reason or age).
func teamTaskBoardStateOf(it teamTaskBoardItem, now time.Time) (teamTaskBoardState, string) {
	switch {
	case it.wsEnded:
		return teamTaskHidden, ""
	case it.Paused != "":
		if teamTaskBoardWaitUser.MatchString(it.PauseWhy) {
			return teamTaskWaiting, teamTaskBoardReason(it.PauseWhy, it.Status)
		}
		return teamTaskPaused, ""
	case strings.HasPrefix(strings.TrimSpace(it.Status), "完成"):
		return teamTaskHidden, ""
	case teamOtherQuiet.MatchString(it.Status):
		return teamTaskWaiting, teamTaskBoardReason(it.Status)
	}
	last := teamTaskBoardLastActive(it, now)
	if it.WS != "" && it.ProgressAt == 0 && !last.IsZero() && now.Sub(last) >= teamTaskBoardStuckAfter {
		return teamTaskStuck, fmt.Sprintf("交出 %d 小时没人接", int(now.Sub(last)/time.Hour))
	}
	return teamTaskRunning, teamTaskBoardAgo(last, now)
}

// teamTaskBoardMarks: the row mark of each listed state.
var teamTaskBoardMarks = map[teamTaskBoardState]string{teamTaskStuck: "⚠", teamTaskRunning: "▶", teamTaskWaiting: "⏸"}

// teamTaskBoardNames: the state's word on the board.
var teamTaskBoardNames = map[teamTaskBoardState]string{teamTaskStuck: "卡住", teamTaskRunning: "在做", teamTaskWaiting: "等你"}

// renderTeamTaskBoard renders a chat channel's task-board section, or "" when it has nothing
// there. It answers 「整体怎样、哪些等我」 — 卡住 and 等你 one item per line with their reason,
// 在做 on one line, paused items as a count. A workspace item is marked with its workspace's
// name. Items must be placed (placeTeamTaskBoard). Done items are not shown (user, 2026-10-28:
// 「完成的也没必要显示」).
func renderTeamTaskBoard(items []teamTaskBoardItem, chat string, now time.Time) string {
	rows := map[teamTaskBoardState][]string{}
	paused := 0
	for _, it := range items {
		if !it.shownIn(chat) {
			continue
		}
		state, note := teamTaskBoardStateOf(it, now)
		if state == teamTaskPaused {
			paused++
			continue
		}
		if state == teamTaskHidden {
			continue
		}
		name := teamTaskBoardMarks[state] + " " + teamTaskBoardShort(it)
		if it.parent == chat && it.own != chat && it.wsName != "" {
			name += "（" + boardLabel(it.wsName) + "）"
		}
		if state != teamTaskRunning && note != "" {
			name += " · " + note
		}
		rows[state] = append(rows[state], name)
	}
	if len(rows) == 0 {
		return "" // only paused items here: no board (same as before, paused items alone never kept one)
	}
	lines := []string{"**任务板**"}
	for _, state := range []teamTaskBoardState{teamTaskStuck, teamTaskRunning, teamTaskWaiting} {
		r := rows[state]
		if len(r) == 0 {
			continue
		}
		head := fmt.Sprintf("**%s %d**", teamTaskBoardNames[state], len(r))
		if state == teamTaskRunning {
			lines = append(lines, head+"  "+strings.Join(r, "  "))
			continue
		}
		lines = append(lines, head)
		lines = append(lines, r...)
	}
	if paused > 0 {
		lines = append(lines, fmt.Sprintf("暂停 %d 件（已收起）", paused))
	}
	return strings.Join(lines, "\n")
}

// renderTeamTaskBoardFit: renderTeamTaskBoard cut by whole lines to budget runes. Running items
// are never dropped (board.py card_text): the section keeps at least its lines up to the 在做 line,
// so a long board above it is cut instead (withTeamTaskBoard).
func renderTeamTaskBoardFit(items []teamTaskBoardItem, chat string, now time.Time, budget int) string {
	s := renderTeamTaskBoard(items, chat, now)
	lines := strings.Split(s, "\n")
	running := "**" + teamTaskBoardNames[teamTaskRunning] + " "
	for k, ln := range lines {
		if strings.HasPrefix(ln, running) {
			keep := len([]rune(strings.Join(lines[:k+1], "\n"))) + 1 + len([]rune(fmt.Sprintf("…还有 %d 件放不下", len(lines))))
			budget = max(budget, keep)
			break
		}
	}
	return cutTeamBoardLines(s, budget, "")
}

// renderWorkspaceTaskBoardFit: a workspace's board answers only 「这里在干什么」: its own items one
// per line (卡住, 在做, 等你), paused ones counted. Nothing from other channels (user, 2026-10-28:
// 「不应该挂到其他频道，其他频道自己收敛」). "" when nothing to show.
func renderWorkspaceTaskBoardFit(items []teamTaskBoardItem, chat string, now time.Time, budget int) string {
	rows := map[teamTaskBoardState][]string{}
	paused := 0
	for _, it := range items {
		if !it.shownIn(chat) {
			continue
		}
		switch st, note := teamTaskBoardStateOf(it, now); st {
		case teamTaskPaused:
			paused++
		case teamTaskHidden:
		default:
			line := teamTaskBoardMarks[st] + " " + teamTaskBoardShort(it) + " · " + teamTaskBoardNames[st]
			if note != "" {
				line += " · " + note
			}
			rows[st] = append(rows[st], line)
		}
	}
	if len(rows) == 0 {
		return "" // only paused items here: no board (same as before, paused items alone never kept one)
	}
	lines := []string{"**这里在做**"}
	for _, st := range []teamTaskBoardState{teamTaskStuck, teamTaskRunning, teamTaskWaiting} {
		lines = append(lines, rows[st]...)
	}
	if paused > 0 {
		lines = append(lines, fmt.Sprintf("暂停 %d 件（已收起）", paused))
	}
	return cutTeamBoardLines(strings.Join(lines, "\n"), budget, "")
}

// teamOtherQuiet: statuses of items not in work, kept off 「其他频道」 (完成, 等用户看片/拍板).
var teamOtherQuiet = regexp.MustCompile(`^完成|等待?用户|待用户`)

// teamChatRef: how a board names another channel (a chat key or session key): on Discord the
// channel mention <#id>, which shows as a clickable 「#频道名」; elsewhere #name (the channel name
// the status file recorded), else #id.
func teamChatRef(chat, name string) string {
	plat, id, _ := strings.Cut(chatOf(chat), ":")
	switch {
	case plat == "discord" && id != "":
		return "<#" + id + ">"
	case strings.TrimSpace(name) != "":
		return "#" + taskIndexLabel(name, teamBoardTaskRunes)
	case id != "":
		return "#" + id
	}
	return "别的频道"
}

// withTeamTaskBoard appends the task-board section to a board and keeps the whole within one
// Discord post (backfillMaxMsgRunes, the same platform limit board.py's card used). section(budget)
// renders the section to fit budget runes (renderTeamTaskBoardFit). Cuts are by whole lines:
// the task section keeps its running items before the member board keeps its tail.
func withTeamTaskBoard(board string, section func(budget int) string) string {
	const limit = backfillMaxMsgRunes
	runes := func(s string) int { return len([]rune(s)) }
	sec := section(limit - runes(board) - 2)
	if sec == "" {
		return board
	}
	if board == "" {
		// A quiet board can be index-only; do not leave separator blank lines.
		return sec
	}
	if runes(sec) > limit {
		// Dozens running at once: even the last stage does not fit a post alone.
		return cutTeamBoardLines(sec, limit, "")
	}
	if room := limit - runes(sec) - 2; runes(board) > room {
		if room <= 0 {
			return sec
		}
		board = cutTeamBoardLines(board, room, "…")
	}
	return board + "\n\n" + sec
}

// teamBoardRowLine: a line that is one task row: an item of the four-state board (⚠/▶/⏸, #610)
// or an older "#…"/"- …" row.
func teamBoardRowLine(s string) bool {
	for _, p := range []string{"#", "- ", "⚠ ", "▶ ", "⏸ "} {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}

// cutTeamBoardLines keeps whole lines of s within limit runes, ending with a note of what is cut
// ("…还有 N 件放不下" counting task rows (teamBoardRowLine), or note when given).
func cutTeamBoardLines(s string, limit int, note string) string {
	if len([]rune(s)) <= limit {
		return s
	}
	lines := strings.Split(s, "\n")
	var out []string
	for k, ln := range lines {
		n := note
		if n == "" {
			left := 0
			for _, x := range lines[k:] {
				if teamBoardRowLine(x) {
					left++
				}
			}
			n = fmt.Sprintf("…还有 %d 件放不下", left)
		}
		if len([]rune(strings.Join(append(append([]string{}, out...), ln, n), "\n"))) > limit {
			return strings.Join(append(out, n), "\n")
		}
		out = append(out, ln)
	}
	return strings.Join(out, "\n")
}

// whoInWorkspace: a workspace item's who with its workspace named elsewhere (heading or 「<name>·」).
// ws-handoff writes who as 「<workspace name><lead name>」 (board.py WS_NAME_RE), so the name is cut
// off: 「工作区1·橘」 not 「工作区1·工作区1橘」 (#597 G38, v0.1.25 web check).
func whoInWorkspace(it teamTaskBoardItem) string {
	if it.wsName != "" {
		if rest, ok := strings.CutPrefix(it.Who, it.wsName); ok {
			return boardLabel(strings.TrimSpace(rest))
		}
	}
	return boardLabel(it.Who)
}

// teamTaskBoardChannelsEvery: how often the board re-lists the guild's channels to notice deleted
// ones. Source: board loop runs every 10s; a channel list is one platform call, so once per
// handoff watch interval (the 10-minute watchdog the team rules use) is enough.
const teamTaskBoardChannelsEvery = 10 * time.Minute

// teamTaskBoardChannels: the last channel list of each platform's main-chat guild (id set), so the
// 10s board loop asks the platform at most once per teamTaskBoardChannelsEvery.
var teamTaskBoardChannels struct {
	sync.Mutex
	at  map[string]time.Time
	ids map[string]map[string]bool
}

// dropGoneTeamTaskBoard leaves out items whose channel was deleted (plan the user approved
// 2026-10-28: 「所在频道已删的条目收起」). Only checked where the platform lists its channels
// (TeamWorkspaceChannels) from the main chat; on an error nothing is dropped. The item stays in
// board.jsonl, so the board command still lists it.
func (e *Engine) dropGoneTeamTaskBoard(items []teamTaskBoardItem) []teamTaskBoardItem {
	main := teamMainChat(e.dataDir)
	plat, mainID, _ := strings.Cut(main, ":")
	if mainID == "" {
		return items
	}
	lister, ok := e.platformForName(plat).(TeamWorkspaceChannels)
	if !ok {
		return items
	}
	c := &teamTaskBoardChannels
	c.Lock()
	if c.at == nil {
		c.at, c.ids = map[string]time.Time{}, map[string]map[string]bool{}
	}
	if time.Since(c.at[plat]) >= teamTaskBoardChannelsEvery {
		c.at[plat] = time.Now() // also on error: do not ask again every 10s
		ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
		self, all, err := lister.TeamGuildChannels(ctx, mainID)
		cancel()
		if err != nil {
			slog.Warn("team task board: list channels failed; not hiding items of deleted channels", "platform", plat, "error", err)
			delete(c.ids, plat)
		} else {
			ids := map[string]bool{self.ID: true}
			for _, ch := range all {
				ids[ch.ID] = true
			}
			c.ids[plat] = ids
		}
	}
	ids := c.ids[plat]
	c.Unlock()
	if len(ids) == 0 {
		return items
	}
	out := items[:0:0]
	for _, it := range items {
		p, id, _ := strings.Cut(it.own, ":")
		if p == plat && id != "" && !ids[id] {
			continue
		}
		out = append(out, it)
	}
	return out
}
