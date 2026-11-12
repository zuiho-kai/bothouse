package core

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// #208: the watch renews a workspace every ten minutes when it sees progress, but the board row
// kept the time of the last hand edit (or of the last ws-up report), so a workspace that worked
// for hours showed 「上次进展 3 小时前」 on the table and then 卡住 (1h) / 搁置 (24h) on live work.
// Every renewal now writes the row's 最后活动时间 (progress_at, the field board.py progress and
// _touch_progress already maintain) and the latest tool step of that workspace.
//
// Source: 交接 notes/board-auto-progress-20261105.handoff.md :10「看门每 10 分钟查到工作区有动静时，
// 把「最后活动时间 + 最近一步」写回对应任务板条目」.

const (
	// boardProgressStepRunes: how much of the latest step goes on the board row. Source: 交接
	// board-auto-progress-20261105 :10「最近一条工具调用首行截 40 字」.
	boardProgressStepRunes = 40
	// boardProgressLockWait: how long one board write waits for board.py's lock before giving up
	// this check (the next one is ten minutes away). Source: 实测一次 board update 亚秒返回，
	// 2 秒还拿不到锁就是别的进程卡在写板上，不值得拖住看门这一轮。
	boardProgressLockWait = 2 * time.Second
	// boardProgressLockPoll: retry interval while waiting for that lock. Source: 沿用
	// contrib/gate/filelock.py 的 0.2 秒重试间隔。
	boardProgressLockPoll = 200 * time.Millisecond
)

// markBoardProgress writes 「最后活动 + 最近一步」 back to the board item of this workspace
// handoff. Non-fatal by design: a board that cannot be written must not turn a renewal into a
// park or a failed check, so every failure is one log line and the caller keeps its due time.
func (w *handoffWatch) markBoardProgress(key string, h TeamHandoff, since, now time.Time) {
	e := w.e
	if e == nil {
		return
	}
	dir := e.teamStatusDir()
	if dir == "" {
		return
	}
	// #699: the item is the one this handoff was claimed for (h.Board, recorded by the claim), and
	// only while that task's state says it is in work in this workspace. Guessing it from the
	// workspace and the title (handoffBoardID) put #679's renewals on the paused #677 (11-11
	// 16:05/16:15): the watch's park marked only the handoff, and #677's row still named 工作区3.
	id := h.Board
	if id <= 0 {
		return // claimed without a board item: nothing to write back
	}
	teamWorkspaceStore.mu.Lock()
	t, inWork, err := teamTaskInWorkOnLocked(e.dataDir, id, key)
	if err != nil {
		teamWorkspaceStore.mu.Unlock()
		slog.Warn("team watch: task state unreadable; board progress not written", "board", id, "error", err)
		return
	}
	if inWork && t.State == TeamTaskDispatched {
		if _, err := transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: id, To: TeamTaskWorking, By: "watch: progress"}, now); err != nil {
			slog.Warn("team watch: task state not moved to working", "board", id, "error", err)
		}
	}
	teamWorkspaceStore.mu.Unlock()
	if !inWork {
		return // paused, handed back or moved to another workspace: not this workspace's row any more
	}
	if teamTurnOfOtherTask(key, id) {
		return // the turn running here is another task's: its progress is not this row's (#699 B)
	}
	// lastStep stays empty when this renewal window had no tool call at all (the turn journal
	// drops the entry when the turn ends, team_journal.go), and an empty step must not replace a
	// precise one with 「已开工」: markStartedHandoffs keeps the same guard (team_board_autostart.go
	// :79). Such a round still raises progress_at — the workspace did speak — it just leaves the
	// status alone (复核 2026-11-06 必修①).
	lastStep := w.workspaceLastStep(key, since)
	step := boardProgressStep(lastStep)
	wrote, err := writeBoardProgress(dir, id, step, lastStep != "", key, now)
	if err != nil {
		slog.Warn("team watch: cannot write the board item's progress", "board", id, "workspace", key, "error", err)
		return
	}
	if wrote {
		slog.Info("team watch: board item progress written", "board", id, "workspace", key, "step", step)
	}
}

// boardProgressStep: the step text for a board row — its first line, whitespace collapsed, ANSI
// escapes and control characters dropped, full-width ｜ swapped for ASCII so board.py fmt keeps its
// five columns, cut to boardProgressStepRunes; boardNoStep when that workspace has not run a tool
// yet. Source: 复核 2026-11-06 建议③ 实测 `\x1b[31m`、`\x07`、`｜` 会原样进表格。
func boardProgressStep(step string) string {
	step = strings.TrimSpace(step)
	if i := strings.IndexByte(step, '\n'); i >= 0 {
		step = step[:i]
	}
	step = ansiEscape.ReplaceAllString(step, "")
	step = strings.Join(strings.Fields(step), " ")
	step = strings.Map(func(r rune) rune {
		if r == '｜' {
			return '|' // 全角竖线是 board.py fmt 的列分隔符
		}
		if r < 0x20 || r == 0x7f || r >= 0x80 && r <= 0x9f {
			return -1
		}
		return r
	}, step)
	if step == "" {
		return boardNoStep
	}
	return truncateRunes(step, boardProgressStepRunes)
}

// ansiEscape: CSI sequences and the two-byte escapes tools emit in coloured output.
var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]|\x1b[@-_]`)

// writeBoardProgress: set progress_at on board item id and, while its status is still a placeholder
// (已交接 or 在做：已开工), fill it with 「在做：<step>」. #699 design §4: the status column is display
// text, so the watch no longer records which step it wrote to tell its own text from the
// workspace's (the progress_step guard is gone); once the status says anything else it is left
// alone and only progress_at moves. hasStep false: this round saw no tool call. wrote false: the row is gone or no longer live work (paused, moved off the
// workspace, closed) — nothing changed and nothing to log.
//
// The file is rewritten the way board.py _write does it (whole file, tmp + os.replace) while
// holding the same lock board.py takes; rows other than the one this write touches keep their
// exact bytes (the touched row is re-encoded, so its key order and escaping can shift once — 复核
// 2026-11-06 建议⑥).
func writeBoardProgress(dir string, id int, step string, hasStep bool, key string, now time.Time) (bool, error) {
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
	changed := false
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
		var status, ws, paused string
		_ = json.Unmarshal(row["status"], &status)
		_ = json.Unmarshal(row["ws"], &ws)
		_ = json.Unmarshal(row["paused"], &paused)
		self := strings.TrimSpace(status)
		// #699 D: whether this row is live work in this workspace is the task's state (checked by
		// markBoardProgress before it gets here), not its status text; the closing-word test is gone.
		// The row's own binding is still checked so a stale board row never takes another's write.
		if ws == "" || teamChatKey(ws) != key || paused != "" {
			return false, nil
		}
		stamp := float64(now.UnixNano()) / 1e9
		var prevStamp float64
		_ = json.Unmarshal(row["progress_at"], &prevStamp)
		if stamp > prevStamp { // only raise, same rule as board.py _touch_progress
			row["progress_at"] = rawJSON(stamp)
			changed = true
		}
		// A round with no tool call only proves the workspace spoke, so it raises progress_at and
		// leaves the step alone instead of degrading it to 「已开工」 (必修①).
		if hasStep && (self == boardHandedOff || self == boardStartedNoStep) {
			row["status"] = rawJSON("在做：" + step)
			changed = true
		}
		out, err := json.Marshal(row)
		if err != nil {
			return false, err
		}
		lines[i] = string(out)
	}
	if !changed {
		return false, nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		return false, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return false, err
	}
	return true, nil
}

// rawJSON: v as it must appear inside a board row (a marshal error leaves the field unset).
func rawJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}
