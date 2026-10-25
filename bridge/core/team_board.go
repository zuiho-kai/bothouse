package core

// maomao fork: live "who is doing what" board.
//
// The primary role reads every project's status file (see team.go) and keeps one message per
// channel that lists each teammate on one line, edited in place, so the channel shows who is
// working on what without new messages piling up. Only real work appears: a turn that used a
// tool or ran longer than teamBoardWorkAfter. Plain chat replies leave the board unchanged.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// teamBoardInterval is how often the lead refreshes its boards (a var so tests can shorten it).
var teamBoardInterval = 10 * time.Second

const (
	teamBoardWorkAfter = time.Minute
	teamBoardTaskRunes = 40
	teamBoardFileExt   = ".board"
)

// boardChat is what the lead remembers about one channel's board.
type boardChat struct {
	SessionKey string `json:"session_key"`
	MessageID  string `json:"message_id"`
	Content    string `json:"content"`
	// GaveUpAt is when the platform stopped letting us edit this board (e.g.
	// it sits in an archived thread). Until the channel has newer activity the
	// board is left alone: no retries and no new board that would bump the
	// thread. Newer activity earns one more try, so a reopened thread heals.
	GaveUpAt time.Time `json:"gave_up_at,omitzero"`
}

// SetTeamBoard turns the live board on or off. It only runs on the primary role; a
// project that is no longer the lead removes the boards it posted before.
func (e *Engine) SetTeamBoard(on bool) {
	t := e.team
	if t == nil {
		return
	}
	t.mu.Lock()
	t.boardEnabled = on
	t.mu.Unlock()
	if !on || !e.isTeamLead() {
		t.mu.Lock()
		t.board = false
		t.mu.Unlock()
		if _, err := os.Stat(filepath.Join(t.dir, e.name+teamBoardFileExt)); err == nil {
			go e.retireTeamBoards()
		}
		return
	}
	t.mu.Lock()
	start := on && !t.board
	t.board = on
	t.mu.Unlock()
	if start {
		go e.runTeamBoard()
	}
}

func (e *Engine) runTeamBoard() {
	tick := time.NewTicker(teamBoardInterval)
	defer tick.Stop()
	t := e.team
	statePath := filepath.Join(t.dir, e.name+teamBoardFileExt)
	boards := map[string]*boardChat{}
	if raw, err := os.ReadFile(statePath); err == nil {
		if err := json.Unmarshal(raw, &boards); err != nil {
			slog.Warn("team board: bad state file", "path", statePath, "error", err)
		}
	}
	cardTries := 0 // retireBoardPyCards runs on the first ticks until done (platforms may still be connecting)
	for {
		select {
		case <-e.ctx.Done():
			return
		case <-tick.C:
		}
		t = e.team
		if t == nil {
			return
		}
		t.mu.Lock()
		on := t.board
		t.mu.Unlock()
		if !on {
			return
		}
		if cardTries < teamBoardRetireTries {
			cardTries++
			if e.retireBoardPyCards(t.dir) {
				cardTries = teamBoardRetireTries // all gone (or none): stop looking
			}
		}
		files := readTeamFiles(t.dir, time.Now())
		if e.updateTeamBoards(files, boards) {
			if out, err := json.MarshalIndent(boards, "", "  "); err == nil {
				if err := AtomicWriteFile(statePath, out, 0o600); err != nil {
					slog.Warn("team board: save state failed", "error", err)
				}
			}
		}
	}
}

// teamBoardRetireTries bounds how long a former lead keeps trying to delete its
// old boards (platforms may still be connecting right after start).
var (
	teamBoardRetireTries = 30
	teamBoardRetireEvery = teamBoardInterval
)

// retireTeamBoards deletes this project's old boards (e.g. after the lead moved
// to another bot), then the state file. Boards that fail with a temporary error
// stay in the file so the next start tries again; boards the platform reports as
// unremovable are dropped after one try.
func (e *Engine) retireTeamBoards() {
	statePath := filepath.Join(e.team.dir, e.name+teamBoardFileExt)
	tick := time.NewTicker(teamBoardRetireEvery)
	defer tick.Stop()
	for try := 0; try < teamBoardRetireTries; try++ {
		select {
		case <-e.ctx.Done():
			return
		case <-tick.C:
		}
		raw, err := os.ReadFile(statePath)
		if err != nil {
			return
		}
		boards := map[string]*boardChat{}
		if err := json.Unmarshal(raw, &boards); err != nil {
			slog.Warn("team board: bad state file", "path", statePath, "error", err)
			return
		}
		for chat, b := range boards {
			platform, _, _ := strings.Cut(chat, ":")
			remover, ok := e.platformForName(platform).(BoardRemover)
			if !ok {
				continue
			}
			if b.MessageID != "" {
				ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
				err := remover.RemoveBoard(ctx, b.SessionKey, b.MessageID)
				cancel()
				if errors.Is(err, ErrDeliveryUnrecoverable) {
					// Retrying cannot help (archived thread, lost access): forget it.
					slog.Warn("team board: old board cannot be removed, giving up", "chat", chat, "error", err)
					delete(boards, chat)
					continue
				}
				if err != nil {
					slog.Warn("team board: remove old board failed", "chat", chat, "error", err)
					continue
				}
			}
			slog.Info("team board: removed old board (no longer lead)", "chat", chat)
			delete(boards, chat)
		}
		if len(boards) == 0 {
			if err := os.Remove(statePath); err != nil {
				slog.Warn("team board: remove state failed", "error", err)
			}
			return
		}
		if out, err := json.MarshalIndent(boards, "", "  "); err == nil {
			if err := AtomicWriteFile(statePath, out, 0o600); err != nil {
				slog.Warn("team board: save retirement state failed", "error", err)
			}
		}
	}
}

// boardPyCardsFile: <team_status_dir>/board-cards.state, {"<Discord channel id>": "<message id>"},
// the pinned task cards contrib/gate/board.py posted with a Discord token before the native board
// rendered board.jsonl (#597 K9). Those cards are no longer edited.
const boardPyCardsFile = "board-cards.state"

// retireBoardPyCards deletes board.py's old pinned cards, so a channel shows one task board (the
// native one) and no frozen copy. Deleted or unremovable cards leave the file; it is removed when
// empty. Reports whether nothing is left to retire.
func (e *Engine) retireBoardPyCards(dir string) bool {
	path := filepath.Join(dir, boardPyCardsFile)
	raw, err := os.ReadFile(path)
	if err != nil {
		return true
	}
	cards := map[string]string{}
	if err := json.Unmarshal(raw, &cards); err != nil {
		slog.Warn("team board: bad board.py card state, left alone", "path", path, "error", err)
		return true
	}
	remover, ok := e.platformForName("discord").(BoardRemover)
	if !ok {
		return len(cards) == 0
	}
	changed := false
	for ch, mid := range cards {
		key := ch
		if !strings.Contains(key, ":") {
			key = "discord:" + ch
		}
		if mid != "" {
			ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
			err := remover.RemoveBoard(ctx, key, mid)
			cancel()
			if err != nil && !errors.Is(err, ErrDeliveryUnrecoverable) {
				slog.Warn("team board: remove board.py card failed, will retry", "chat", key, "error", err)
				continue
			}
			if err != nil {
				slog.Warn("team board: board.py card cannot be removed, giving up", "chat", key, "error", err)
			} else {
				slog.Info("team board: removed board.py pinned card (moved to the team board)", "chat", key)
			}
		}
		delete(cards, ch)
		changed = true
	}
	if len(cards) == 0 {
		if err := os.Remove(path); err != nil {
			slog.Warn("team board: remove board.py card state failed", "error", err)
		}
		return true
	}
	if changed {
		if out, err := json.Marshal(cards); err == nil {
			if err := AtomicWriteFile(path, out, 0o600); err != nil {
				slog.Warn("team board: save board.py card state failed", "error", err)
			}
		}
	}
	return false
}

// updateTeamBoards posts or edits each channel's board; it reports whether boards changed.
func (e *Engine) updateTeamBoards(files []teamFile, boards map[string]*boardChat) bool {
	// A channel gets a board once real work shows up there; after that it stays and is kept current.
	// lastActive is each channel's newest work time, used to retry a given-up board.
	lastActive := map[string]time.Time{}
	noteActive := func(chat string, ts ...time.Time) {
		for _, t := range ts {
			if t.After(lastActive[chat]) {
				lastActive[chat] = t
			}
		}
	}
	var items, done []teamTaskBoardItem
	var pending []*TimerJob
	now := time.Now()
	if e.team != nil {
		place := e.teamTaskBoardPlacer()
		items = placeTeamTaskBoard(place, readTeamTaskBoard(e.team.dir))
		done = placeTeamTaskBoard(place, readTeamTaskBoardDoneToday(e.team.dir, now))
		if e.timerScheduler != nil {
			pending = append([]*TimerJob{}, e.timerScheduler.Store().ListPending()...)
		}
	}
	for _, it := range items { // a chat with task-board items gets a board too (board.py no longer posts its own card)
		for _, key := range it.chats() {
			if boards[key] == nil {
				boards[key] = &boardChat{SessionKey: key}
			}
		}
	}
	for _, f := range files {
		for _, task := range f.Tasks {
			if !listedTaskState(task.State) || !safeTaskURL(task.URL) || task.SessionKey == "" {
				continue
			}
			chat := chatOf(task.SessionKey)
			if boards[chat] == nil {
				boards[chat] = &boardChat{SessionKey: task.SessionKey}
			}
			noteActive(chat, task.UpdatedAt)
			for _, m := range task.Members {
				noteActive(chat, m.UpdatedAt)
			}
		}
		for _, s := range f.Sessions {
			if !s.Worked || s.Chat == "" {
				continue
			}
			chat := chatOf(s.Key)
			if _, ok := boards[chat]; !ok {
				boards[chat] = &boardChat{SessionKey: s.Key}
			}
			noteActive(chat, s.Since, s.DoneAt)
		}
	}
	changed := false
	for chat, b := range boards {
		if !b.GaveUpAt.IsZero() {
			if !lastActive[chat].After(b.GaveUpAt) {
				continue
			}
			// New activity since we gave up: try once more (thread may be reopened).
			b.GaveUpAt = time.Time{}
			changed = true
		}
		content := withTeamTaskBoard(renderTeamBoardWithTasks(files, chat, e.i18n.CurrentLang()), func(budget int) string {
			return renderTeamTaskBoardFit(items, done, chat, now, pending, budget)
		})
		if content == b.Content {
			continue
		}
		platform, _, _ := strings.Cut(chat, ":")
		poster, ok := e.platformForName(platform).(BoardPoster)
		if !ok {
			continue
		}
		ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
		id, err := poster.UpsertBoard(ctx, b.SessionKey, b.MessageID, content)
		cancel()
		// A successful send can be followed by a failed pin. Persist its ID
		// before retrying so recovery edits/pins the same board.
		if id != "" && id != b.MessageID {
			b.MessageID = id
			changed = true
		}
		if errors.Is(err, ErrDeliveryUnrecoverable) {
			slog.Warn("team board: board can no longer be edited, giving up until new activity", "chat", chat, "error", err)
			// Never earlier than the activity just seen, so it is not retried again.
			b.GaveUpAt = time.Now()
			if lastActive[chat].After(b.GaveUpAt) {
				b.GaveUpAt = lastActive[chat]
			}
			changed = true
			continue
		}
		if err != nil {
			slog.Warn("team board: update failed", "chat", chat, "error", err)
			continue
		}
		b.MessageID, b.Content = id, content
		changed = true
	}
	return changed
}

// readTeamFiles loads every fresh status file in dir, sorted by project.
func readTeamFiles(dir string, now time.Time) []teamFile {
	paths, _ := filepath.Glob(filepath.Join(dir, "*"+teamStatusFileExt))
	var files []teamFile
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var f teamFile
		if json.Unmarshal(raw, &f) != nil || now.Sub(f.Updated) > teamStaleAfter {
			continue
		}
		files = append(files, f)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Project < files[j].Project })
	return files
}

// renderTeamBoard renders one line per teammate for the board in chat. Times are wall-clock
// ("10:42 起") rather than elapsed, so the text only changes when someone's state changes.
// Task text from another channel is never shown here; only that the teammate is busy elsewhere.
func renderTeamBoard(files []teamFile, chat string) string {
	return renderTeamBoardMembers(files, chat, nil)
}

var teamMemberStatus = map[string]string{
	"queued": "待开始", "running": "进行中", "waiting": "等待中",
	"completed": "已完成", "failed": "失败", "cancelled": "已取消", "interrupted": "已中断",
}

// boardMember picks the teammate's task-card row in this chat: live rows
// first, then the latest progress. Native children share their owner's bot
// account and are not roster entries.
func boardMember(f teamFile, members []teamTaskMember) *teamTaskMember {
	var best *teamTaskMember
	for i := range members {
		m := &members[i]
		if m.ParentID != "" {
			continue
		}
		if m.ReporterProject != "" {
			if m.ReporterProject != f.Project {
				continue
			}
		} else if m.Name == "" || m.Name != f.Name {
			continue
		}
		if best == nil || (m.live() && !best.live()) || (m.live() == best.live() && m.UpdatedAt.After(best.UpdatedAt)) {
			best = m
		}
	}
	return best
}

func (m *teamTaskMember) live() bool {
	return m.Status == "queued" || m.Status == "running" || m.Status == "waiting"
}

func renderTeamBoardMembers(files []teamFile, chat string, members []teamTaskMember) string {
	lines := []string{"**谁在干啥**"}
	for _, f := range files {
		var best *teamEntry
		rank := 0
		for i := range f.Sessions {
			s := &f.Sessions[i]
			if !s.Worked {
				continue
			}
			r := 1 // recently done elsewhere: not worth showing
			switch {
			case s.Busy && chatOf(s.Key) == chat:
				r = 4
			case s.Busy:
				r = 3
			case chatOf(s.Key) == chat:
				r = 2
			}
			// Entries come from a map snapshot. Prefer the latest work within
			// the same rank so an older success cannot hide a newer failure.
			newer := false
			if best != nil {
				if s.Busy {
					newer = s.Since.After(best.Since)
				} else {
					newer = s.DoneAt.After(best.DoneAt)
				}
			}
			if r > rank || (r == rank && newer) {
				best, rank = s, r
			}
		}
		line := "💤 空闲"
		if best != nil {
			task := boardTask(best.Task)
			switch rank {
			case 4:
				line = fmt.Sprintf("🔧 %s（%s 起）", task, best.Since.Local().Format("15:04"))
			case 3:
				where := "别的频道"
				if best.Chat != "" {
					where = "#" + best.Chat
				}
				line = fmt.Sprintf("🔧 在%s忙（%s 起）", where, best.Since.Local().Format("15:04"))
			case 2:
				switch best.Outcome {
				case teamWorkFailed:
					line = fmt.Sprintf("❌ %s（%s）", task, best.DoneAt.Local().Format("15:04"))
				case teamWorkUnconfirmed:
					line = fmt.Sprintf("⚠️ %s（%s）", task, best.DoneAt.Local().Format("15:04"))
				default:
					line = fmt.Sprintf("✅ 做完：%s（%s）", task, best.DoneAt.Local().Format("15:04"))
				}
			}
		}
		// A task-card assignment in this chat outranks being busy elsewhere
		// or idle; a live turn here still shows what is happening right now.
		if m := boardMember(f, members); m != nil && rank < 4 && (m.live() || rank < 2 || m.UpdatedAt.After(best.DoneAt)) {
			icon := "📋"
			switch m.Status {
			case "completed":
				icon = "✅"
			case "failed", "cancelled", "interrupted":
				icon = "❌"
			case "waiting":
				icon = "⏳"
			}
			status := teamMemberStatus[m.Status]
			if status == "" {
				status = taskIndexLabel(m.Status, 12)
			}
			line = fmt.Sprintf("%s %s（%s · %s）", icon, boardTask(taskIndexLabel(m.Title, teamBoardTaskRunes*2)), status, m.UpdatedAt.Local().Format("15:04"))
		}
		lines = append(lines, fmt.Sprintf("**%s**　%s", f.Name, line))
	}
	return strings.Join(lines, "\n")
}

func boardTask(task string) string {
	if task == "" {
		return "处理中"
	}
	if r := []rune(task); len(r) > teamBoardTaskRunes {
		return string(r[:teamBoardTaskRunes]) + "…"
	}
	return task
}
