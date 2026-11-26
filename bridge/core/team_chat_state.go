package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Task states in the chat itself (#1965, user 11-24 「感觉任务可视化有强力需求……人脑也切换不过来」,
// approved mock task-vis-mock.pages.dev 「之前改动也要上，但是除了秘书频道不显示其他频道东西」):
//
//	① 等你定 — one message per chat listing what waits on the user there, numbered so a reply of
//	  numbers answers it. A new question moves it to the bottom (old one deleted, renumbered);
//	  an answered one is struck through in place; empty, it says so.
//	② 停了   — said once when an item of this chat stops for another reason (paused waiting
//	  outside, released, or an hour without progress), with what happens next.
//	③ 做完   — the released report itself, one result first (team_report_accept.go chatDoneText).
//	④ 在跑   — nothing is posted; the lead answers 「什么进度」 from its own board block.
//
// Only the chat's own items (shownIn); nothing from other chats. Only on platforms with
// ChatNotePoster (Discord: 「我现在说的只限于discord」).

const teamChatStateExt = ".chatstate"

type chatWaitRow struct {
	ID   int    `json:"id"`
	Line string `json:"line"` // 【名】 and the whole question
	Head string `json:"head"` // 【名】 and the question's title only
}

type chatWaitNote struct {
	SessionKey string        `json:"session_key"`
	MessageID  string        `json:"message_id"`
	Content    string        `json:"content"`
	Rows       []chatWaitRow `json:"rows"`
}

type teamChatState struct {
	// Since: the first pass of this feature; stops older than this are not announced (the
	// channels would otherwise get every item paused before the feature at once).
	Since   time.Time                `json:"since"`
	Waiting map[string]*chatWaitNote `json:"waiting"`
	Stopped map[string]time.Time     `json:"stopped"` // "<id>@<stamp>" → when ② was posted
	// Stops: every ② said, whatever chat it belongs to ("<id>@<stamp>" → the line). The secretary
	// channel (experimental script, not in the product) posts these lines instead of judging stops
	// itself (#1976: the two wrote different 「接下来」 for one stop).
	Stops map[string]chatStopSaid `json:"stops"`
	// KeepArm: keep-running chats whose work may run out and wake the lead once (team_lead_autowake.go).
	KeepArm map[string]*keepArm `json:"keep_arm,omitempty"`
	// KeepOnSeen: chat → the board keep-running on stamp already armed, so it arms once.
	KeepOnSeen map[string]string `json:"keep_on_seen,omitempty"`
	// StuckWoke: "<id>@s<bound>" → when the lead was woken for that stuck item (not a ②, #1993).
	StuckWoke map[string]time.Time `json:"stuck_woke,omitempty"`
}

type chatStopSaid struct {
	ID   int       `json:"id"`
	Chat string    `json:"chat"`
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

func (e *Engine) teamChatStatePath() string {
	if e.team == nil {
		return ""
	}
	return filepath.Join(e.team.dir, e.name+teamChatStateExt)
}

func loadTeamChatState(path string) *teamChatState {
	st := &teamChatState{}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, st)
	}
	if st.Waiting == nil {
		st.Waiting = map[string]*chatWaitNote{}
	}
	if st.Stopped == nil {
		st.Stopped = map[string]time.Time{}
	}
	if st.Stops == nil {
		st.Stops = map[string]chatStopSaid{}
	}
	return st
}

// updateTeamChatStates runs in the board pass (runTeamBoard), on the lead.
func (e *Engine) updateTeamChatStates(now time.Time) {
	path := e.teamChatStatePath()
	if path == "" {
		return
	}
	st := loadTeamChatState(path)
	changed := false
	if st.Since.IsZero() {
		st.Since, changed = now, true
	}
	items := e.dropGoneTeamTaskBoard(placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir)))
	// a report held for the lead's verdict is not a stop yet: the lead may send the work straight
	// back (#2000: #1998 was told 「②停了…等外部」 19 s before the lead redispatched it)
	stopItems := make([]teamTaskBoardItem, 0, len(items))
	for _, it := range items {
		platform, _, _ := strings.Cut(it.Chat, ":")
		if it.ID > 0 && e.reportHeldForLead(platform, it.ID) {
			continue
		}
		stopItems = append(stopItems, it)
	}
	if recordChatStops(st, stopItems, now) {
		changed = true
	}
	chats := map[string]bool{}
	for _, it := range items {
		for _, c := range it.chats() {
			chats[c] = true
		}
	}
	for c := range st.Waiting {
		chats[c] = true
	}
	for chat := range chats {
		if e.teamBoardKindOf(chat) != teamBoardSummary {
			continue
		}
		platform, _, _ := strings.Cut(chat, ":")
		poster, ok := e.platformForName(platform).(ChatNotePoster)
		if !ok {
			continue
		}
		if e.syncChatWaiting(poster, st, chat, items, now) {
			changed = true
		}
		if e.announceChatStops(poster, st, chat, stopItems, now) {
			changed = true
		}
	}
	if e.wakeStuckLeads(st, items, now) {
		changed = true
	}
	if e.wakeKeepRunning(st, items, now) {
		changed = true
	}
	for k, at := range st.StuckWoke {
		if now.Sub(at) > 14*24*time.Hour {
			delete(st.StuckWoke, k)
			changed = true
		}
	}
	for k, at := range st.Stopped {
		if now.Sub(at) > 14*24*time.Hour {
			delete(st.Stopped, k)
			changed = true
		}
	}
	for k, s := range st.Stops {
		if now.Sub(s.At) > 14*24*time.Hour {
			delete(st.Stops, k)
			changed = true
		}
	}
	if changed {
		if b, err := json.MarshalIndent(st, "", "  "); err == nil {
			if err := AtomicWriteFile(path, b, 0o600); err != nil {
				slog.Warn("team chat state: save failed", "error", err)
			}
		}
	}
}

// chatWaitRows: this chat's items waiting on the user, oldest question first.
func chatWaitRows(items []teamTaskBoardItem, chat string, now time.Time) []chatWaitRow {
	type row struct {
		at time.Time
		r  chatWaitRow
	}
	var rows []row
	for _, it := range items {
		if !it.shownIn(chat) || it.Backlog != "" || !it.waitsUser() {
			continue
		}
		at, _ := teamTaskTableAsked(it, now)
		head := it.askTitle()
		if head == "" {
			head = teamTaskBoardReason(it.PauseWhy, teamTaskBoardHumanStatus(it.Status))
		}
		rows = append(rows, row{at, chatWaitRow{ID: it.ID, Line: chatWaitLine(it), Head: "【" + teamTaskBoardShort(it) + "】" + head}})
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].at.Before(rows[j].at) })
	out := make([]chatWaitRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.r)
	}
	return out
}

// chatWaitLine: 「【名】<the question>」 — the whole stored question on one line (the lead's plain
// rewrite carries its options and pick, e.g. 「……我推荐这个；二，……你回一个数字就行」), else its title.
// Same text the pinned table shows in full (#1728); renderChatWaiting falls back to titles when long.
func chatWaitLine(it teamTaskBoardItem) string {
	q := strings.Join(strings.Fields(it.askText), " ")
	if q == "" {
		q = it.askTitle()
	}
	if q == "" {
		q = teamTaskBoardReason(it.PauseWhy, teamTaskBoardHumanStatus(it.Status))
	}
	return "【" + teamTaskBoardShort(it) + "】" + q
}

// chatNoteMaxRunes: one Discord message (2000, platform limit) less room for the header.
const chatNoteMaxRunes = 1900

func renderChatWaiting(rows []chatWaitRow, open map[int]bool) string {
	if out := renderChatWaitingAt(rows, open, true); runeLen(out) <= chatNoteMaxRunes {
		return out
	}
	// too long for one message: titles only, like the pinned table (renderTeamTaskTableAsks)
	return renderChatWaitingAt(rows, open, false)
}

func renderChatWaitingAt(rows []chatWaitRow, open map[int]bool, full bool) string {
	n := 0
	for _, r := range rows {
		if open[r.ID] {
			n++
		}
	}
	if n == 0 {
		return "①等你定：都定了，没有等你的"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "①等你定 %d 件（回数字就行）", n)
	for i, r := range rows {
		line := r.Line
		if !full || r.Line == "" {
			line = r.Head
		}
		if open[r.ID] {
			fmt.Fprintf(&b, "\n%d. %s", i+1, line)
		} else {
			fmt.Fprintf(&b, "\n~~%d. %s~~ 已定", i+1, r.Head) // answered: its title is enough
		}
	}
	return b.String()
}

// syncChatWaiting keeps chat's ① message. A new question renumbers and moves it to the bottom;
// answers only strike rows through, so a number the user already read keeps its meaning.
func (e *Engine) syncChatWaiting(poster ChatNotePoster, st *teamChatState, chat string, items []teamTaskBoardItem, now time.Time) bool {
	cur := chatWaitRows(items, chat, now)
	note := st.Waiting[chat]
	if note == nil && len(cur) == 0 {
		return false
	}
	if note == nil {
		note = &chatWaitNote{SessionKey: chat}
	}
	open := map[int]bool{}
	for _, r := range cur {
		open[r.ID] = true
	}
	shown := map[int]bool{}
	for _, r := range note.Rows {
		shown[r.ID] = true
	}
	move := false
	for _, r := range cur {
		if !shown[r.ID] {
			move = true
		}
	}
	rows := note.Rows
	if move || note.MessageID == "" {
		rows = cur
	} else {
		// keep the numbers; refresh lines of rows still open
		now := map[int]chatWaitRow{}
		for _, r := range cur {
			now[r.ID] = r
		}
		rows = append([]chatWaitRow(nil), note.Rows...)
		for i := range rows {
			if r, ok := now[rows[i].ID]; ok {
				rows[i] = r
			}
		}
	}
	if note.MessageID == "" && len(cur) == 0 {
		return false
	}
	content := renderChatWaiting(rows, open)
	if !move && content == note.Content {
		return false
	}
	ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
	id, err := poster.PostChatNote(ctx, chat, note.MessageID, content, move && note.MessageID != "")
	cancel()
	if err != nil {
		slog.Warn("team chat state: ① update failed", "chat", chat, "error", err)
		if errors.Is(err, ErrDeliveryUnrecoverable) {
			delete(st.Waiting, chat)
			return true
		}
		return false
	}
	note.MessageID, note.Content, note.Rows = id, content, rows
	if len(cur) == 0 {
		// all answered: the cleared message stays; the next question posts a new one at the bottom
		note.Rows = nil
	}
	st.Waiting[chat] = note
	return true
}

// chatStopOf: why item it is stopped and what happens next; "" when it is not a ② stop. The
// stamp keys the stop so it is said once. Only a real stop is a ②: the work is let go (paused,
// workspace released, waiting outside). A watchdog's "stuck" (nudged without progress, wakes
// unanswered, park failed) is the lead's business, not the user's: the workspace still holds it
// and usually reports back on its own (#1993).
func chatStopOf(it teamTaskBoardItem, now time.Time) (stamp string, at time.Time, text string) {
	// a stop the user ordered (「用户 22:2x「不要并行太多」…」) is not news to the user
	if it.Backlog != "" || it.Probe || it.waitsAnswer() || strings.HasPrefix(strings.TrimSpace(it.PauseWhy), "用户") {
		return "", time.Time{}, ""
	}
	name := "【" + teamTaskBoardShort(it) + "】"
	state, why := teamTaskBoardStateOf(it, now)
	switch state {
	case teamTaskPaused:
		at, ok := teamTaskTableAsked(it, now)
		if !ok {
			// released by its workspace without a pause: since its last activity
			at = teamTaskBoardLastActive(it, now)
		}
		// a pause that is over within chatStopSettle was a step, not a stop: rework and
		// ws-handoff --resume pause the item and dispatch it seconds later (#2000)
		if at.IsZero() || now.Sub(at) < chatStopSettle {
			return "", time.Time{}, ""
		}
		if r := strings.TrimSpace(it.PauseWhy); r != "" {
			why = r
		}
		if why == "" {
			why = "没写原因"
		}
		// #1993 user 11-25「为什么自动锤自动拍」: no retry clock, no 「自动」 — what the user can do
		next := "你说接着做就接着派。"
		if it.WaitUntil > 0 {
			next = "卡住的那件事好了再接着做；要现在做或不做了，说一声。"
		}
		stamp = "p" + it.PausedAt + it.Paused
		if it.Paused == "" {
			stamp = "r" + at.Format(time.RFC3339)
		}
		return stamp, at, fmt.Sprintf("②停了%s%s 起停着，卡在：%s\n接下来：%s", name, at.In(now.Location()).Format("15:04"), shortLabel(why, 120), next)
	}
	return "", time.Time{}, ""
}

// chatStopSettle: how long a pause must last before it is a ② stop. The board pass runs every
// teamBoardInterval (10 s); a rework or resume redispatches within seconds (#1974: 7 s).
const chatStopSettle = time.Minute

// recordChatStops keeps st.Stops: the ② line of every stop since Since, in any chat, once.
func recordChatStops(st *teamChatState, items []teamTaskBoardItem, now time.Time) bool {
	changed := false
	for _, it := range items {
		stamp, at, text := chatStopOf(it, now)
		if stamp == "" || at.Before(st.Since) {
			continue
		}
		key := strconv.Itoa(it.ID) + "@" + stamp
		if _, ok := st.Stops[key]; !ok {
			said := now
			if t, ok := st.Stopped[key]; ok {
				said = t // already posted before stops were kept: keep when, so the secretary does not say it again
			}
			st.Stops[key] = chatStopSaid{ID: it.ID, Chat: it.Chat, Text: text, At: said}
			changed = true
		}
	}
	return changed
}

// announceChatStops posts ② once for each stop of this chat's items that began after Since.
func (e *Engine) announceChatStops(poster ChatNotePoster, st *teamChatState, chat string, items []teamTaskBoardItem, now time.Time) bool {
	changed := false
	for _, it := range items {
		if !it.shownIn(chat) {
			continue
		}
		stamp, at, text := chatStopOf(it, now)
		if stamp == "" || at.Before(st.Since) {
			continue
		}
		key := strconv.Itoa(it.ID) + "@" + stamp
		if _, said := st.Stopped[key]; said {
			continue
		}
		ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
		_, err := poster.PostChatNote(ctx, chat, "", text, false)
		cancel()
		if err != nil {
			slog.Warn("team chat state: ② post failed", "chat", chat, "board_item", it.ID, "error", err)
			if !errors.Is(err, ErrDeliveryUnrecoverable) {
				continue
			}
		}
		st.Stopped[key] = now
		changed = true
		if stopWakesLead(it) && !leadAutowake(e, chat, "停摆唤醒 #"+strconv.Itoa(it.ID), stopLeadPrompt(it, text), it.ID) {
			slog.Warn("team chat state: lead not woken for ②", "chat", chat, "board_item", it.ID)
		}
	}
	return changed
}
