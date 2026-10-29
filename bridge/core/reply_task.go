package core

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A user's reply to a task card or to a workspace report is about that work (user 10-29: the
// chat bot kept not getting what a reply meant). The bridge finds the work from the quoted
// message's id and gives the turn its background once per agent context: the board number and
// title, the handoff's 总目标/相关改动/用户原话 sections, the latest report, and a pointer to
// ws-forward when the work still runs in a workspace. The quote itself is kept whole
// (Session.renderReference).
//
// Ids of workspace reports in a chat channel (the 📬 posts and the lead's turn on a handback)
// are recorded with their board number in team_reply_tasks.json, so the lookup survives a
// bridge restart; task cards are found by their record's Task.MessageID.

const (
	replyTaskFile = "team_reply_tasks.json"
	changeHeading = "相关改动"
	// The quote is kept whole in the user's message (renderReference), so it is not repeated.
	replyTaskQuoteNote = "被回复的消息全文在用户这条消息的 [replying to …] 引用里。"
)

// SentMessageRecorder is implemented by platforms that can report the id of each message
// posted with a reply context (the platform's send call returns it). record gets every posted
// id. Which platforms do, and why the others cannot, is in platform/CAPABILITIES.md
// (checked by platform_parity_test.go).
type SentMessageRecorder interface {
	RecordSentMessages(replyCtx any, record func(id string)) any
}

type replyTaskEntry struct {
	ID    string    `json:"id"`
	Board int       `json:"board"`
	At    time.Time `json:"at"`
}

var replyTaskStore struct {
	mu    sync.Mutex
	cache map[string][]replyTaskEntry // path → entries, oldest first
}

func replyTaskPath(dataDir string) string {
	return filepath.Join(dataDir, replyTaskFile)
}

func loadReplyTasksLocked(path string) []replyTaskEntry {
	if list, ok := replyTaskStore.cache[path]; ok {
		return list
	}
	var list []replyTaskEntry
	if raw, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(raw, &list); err != nil {
			slog.Warn("reply task: map unreadable", "path", path, "error", err)
			list = nil
		}
	}
	if replyTaskStore.cache == nil {
		replyTaskStore.cache = map[string][]replyTaskEntry{}
	}
	replyTaskStore.cache[path] = list
	return list
}

// noteReplyTask records that message id reports on board item board.
func (e *Engine) noteReplyTask(id string, board int) {
	if e == nil || e.dataDir == "" || id == "" || board <= 0 {
		return
	}
	path := replyTaskPath(e.dataDir)
	replyTaskStore.mu.Lock()
	defer replyTaskStore.mu.Unlock()
	open := e.openBoardIDs()
	var list []replyTaskEntry
	for _, en := range loadReplyTasksLocked(path) {
		// Entries of items no longer on the board (done or deleted) are dropped as the map is
		// written; open is nil when the board cannot be read, and then nothing is dropped.
		if open == nil || open[en.Board] {
			list = append(list, en)
		}
	}
	list = append(list, replyTaskEntry{ID: id, Board: board, At: time.Now()})
	replyTaskStore.cache[path] = list
	raw, err := json.Marshal(list)
	if err != nil {
		return
	}
	if err := AtomicWriteFile(path, raw, 0o600); err != nil {
		slog.Warn("reply task: save map failed", "path", path, "error", err)
	}
}

// openBoardIDs is the set of ids on the open board (board.jsonl); nil when there is no team
// dir or the board file cannot be read.
func (e *Engine) openBoardIDs() map[int]bool {
	dir := e.teamStatusDir()
	if dir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(dir, teamTaskBoardFile)); err != nil {
		return nil
	}
	open := map[int]bool{}
	for _, it := range readTeamTaskBoard(dir) {
		open[it.ID] = true
	}
	return open
}

func (e *Engine) replyTaskBoard(id string) int {
	if e == nil || e.dataDir == "" || id == "" {
		return 0
	}
	replyTaskStore.mu.Lock()
	defer replyTaskStore.mu.Unlock()
	list := loadReplyTasksLocked(replyTaskPath(e.dataDir))
	for i := len(list) - 1; i >= 0; i-- {
		if list[i].ID == id {
			return list[i].Board
		}
	}
	return 0
}

// recordReplyTask makes every message posted with rc report on board item board.
func (e *Engine) recordReplyTask(p Platform, rc any, board int) any {
	r, ok := p.(SentMessageRecorder)
	if !ok || board <= 0 || e == nil || e.dataDir == "" {
		return rc
	}
	return r.RecordSentMessages(rc, func(id string) { e.noteReplyTask(id, board) })
}

// replyTask is the work a quoted message belongs to: a board item or a task card.
type replyTask struct {
	board int
	card  *Task
}

func (t *replyTask) key() string {
	if t.board > 0 {
		return "board:" + strconv.Itoa(t.board)
	}
	return "card:" + t.card.ID
}

// replyTaskOf finds the work message id belongs to; nil when it is neither a recorded report
// nor a task card.
func (e *Engine) replyTaskOf(id string) *replyTask {
	if id == "" {
		return nil
	}
	if b := e.replyTaskBoard(id); b > 0 {
		return &replyTask{board: b}
	}
	if t := e.taskCardByMessage(id); t != nil {
		return &replyTask{card: t}
	}
	return nil
}

func (e *Engine) taskCardByMessage(id string) *Task {
	if e == nil || e.dataDir == "" {
		return nil
	}
	paths, _ := filepath.Glob(filepath.Join(e.dataDir, "public-progress", "*", "*.json"))
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var rec progressRecord
		if json.Unmarshal(b, &rec) != nil || rec.Task == nil || rec.Task.MessageID != id {
			continue
		}
		return rec.Task
	}
	return nil
}

// noteReplyTaskOf marks msg's quote with the work it belongs to. It runs after the [ask]
// answer route (routeWorkspaceAnswer), which consumes replies to an open [ask].
func (e *Engine) noteReplyTaskOf(msg *Message) {
	if msg == nil || msg.FromBot || msg.Reference == nil || msg.Reference.ID == "" {
		return
	}
	msg.Reference.task = e.replyTaskOf(msg.Reference.ID)
}

// replyTaskBlock is the background of the work ref quotes, once per agent context.
func (e *Engine) replyTaskBlock(session *Session, ref *MessageReference) string {
	if ref == nil || ref.task == nil || session == nil {
		return ""
	}
	key := ref.task.key()
	sent := false
	session.UpdateTurnCtx(func(t *TurnCtxSent) {
		for _, k := range t.ReplyTasks {
			if k == key {
				sent = true
				return
			}
		}
	})
	if sent {
		return ""
	}
	body := e.replyTaskText(ref.task, replyTaskQuote(ref))
	if body == "" {
		return ""
	}
	session.UpdateTurnCtx(func(t *TurnCtxSent) { t.ReplyTasks = append(t.ReplyTasks, key) })
	return body
}

// replyTaskQuote points at the quoted message. Only platforms that wrap the quote in the
// message (Full, e.g. Discord) keep it whole there; for the others the text the platform gave
// (Reference.Text) is written here, and nothing when it gave only the id.
func replyTaskQuote(ref *MessageReference) string {
	if ref.Full != "" {
		return replyTaskQuoteNote
	}
	if t := strings.TrimSpace(ref.Text); t != "" {
		return "被回复的消息：" + truncateRelay(t, backgroundWordsLimit)
	}
	return ""
}

func (e *Engine) replyTaskText(t *replyTask, quote string) string {
	var b strings.Builder
	b.WriteString("（用户回复的那条消息属于下面这件活，系统附上它的背景，不用回应这段）\n")
	if t.card != nil {
		c := t.card
		b.WriteString("任务卡 " + c.ID + "「" + c.Title + "」，状态：" + string(c.State) + "\n")
		if p := strings.TrimSpace(c.LatestProgress); p != "" {
			b.WriteString("最近汇报：" + truncateRelay(p, backgroundWordsLimit) + "\n")
		}
		b.WriteString(quote)
		return strings.TrimRight(b.String(), "\n")
	}
	it := e.boardItemByID(t.board)
	if it == nil {
		return ""
	}
	b.WriteString("任务板 #" + strconv.Itoa(it.ID) + "「" + teamTaskBoardShort(*it) + "」：" + it.What + "\n")
	var parts []string
	for _, h := range []string{goalHeading, changeHeading, userWordsHeading} {
		if s := handoffSection(it.Where, h); s != "" {
			parts = append(parts, h+"：\n"+s)
		}
	}
	if len(parts) > 0 {
		b.WriteString("交接里记的：\n" + truncateRelay(strings.Join(parts, "\n"), backgroundWordsLimit) + "\n")
	}
	if s := strings.TrimSpace(it.Status); s != "" {
		b.WriteString("最近汇报：" + s + "\n")
	}
	b.WriteString(quote)
	if it.WS != "" && it.DoneAt == "" && e.workspaceHasOpenHandoff(it.WS) {
		plat, id, _ := strings.Cut(teamChatKey(it.WS), ":")
		if quote != "" {
			b.WriteString("\n")
		}
		b.WriteString("这件活在工作区 " + channelLabel(plat, id) + " 进行中，追加要求用 ws-forward 转过去。")
	}
	return strings.TrimRight(b.String(), "\n")
}
