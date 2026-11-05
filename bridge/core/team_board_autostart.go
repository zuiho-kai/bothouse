package core

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// #1067: a workspace that started on a handed-off task flips its board item from 「已交接」 to
// 「在做：<latest step>」 by itself, so the lead and the backstop timer can tell "not started" from
// "working without posting". 11-05 #1063: the board said 已交接 for 20 minutes while the workspace
// ran a 19-minute turn; the lead read the board, judged it not started and parked it.

const (
	// boardAutostartEvery: how often the watch looks for started handoffs. Source: 交接
	// board-autostart-1105.md 规矩「看板上 30 秒内变在做」, half of it so one miss still fits.
	boardAutostartEvery = 15 * time.Second
	// boardAutostartRetry: wait after a failed board update. Source: 沿用 watchRetryDelay.
	boardAutostartRetry = watchRetryDelay
	// boardAutostartStepRunes: the step on the board row. Source: 沿用 teamTaskBoardReasonRunes
	// (the board's own cap for a row's free text).
	boardAutostartStepRunes = teamTaskBoardReasonRunes
	// boardHandedOff: the status ws-handoff writes when it hands a task to a workspace
	// (contrib/lead/ws-handoff board.update / board.add "已交接").
	boardHandedOff = "已交接"
	// boardStartedNoStep: what the watch writes for a started turn with no tool step yet.
	boardStartedNoStep = "在做：" + boardNoStep
	boardNoStep        = "已开工"
)

// activeHandoffWatch: the watch the API server runs (all role engines); nil before it starts.
// The backstop prompt reads workspace state through it, since the workspace sessions belong to
// other engines than the chat channel's lead.
var activeHandoffWatch atomic.Pointer[handoffWatch]

func (w *handoffWatch) autostartLoop(ctx context.Context) {
	t := time.NewTicker(boardAutostartEvery)
	defer t.Stop()
	tried := map[int]time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		w.markStartedHandoffs(w.now(), tried)
	}
}

// markStartedHandoffs: every board item still 「已交接」 in a workspace whose sessions produced an
// agent event (team watch's workspaceEventActive) since the handoff gets 「在做：<step>」.
func (w *handoffWatch) markStartedHandoffs(now time.Time, tried map[int]time.Time) {
	e := w.e
	if e == nil || e.dataDir == "" {
		return
	}
	dir := e.teamStatusDir()
	if dir == "" {
		return
	}
	for _, it := range readTeamTaskBoard(dir) {
		status := strings.TrimSpace(it.Status)
		// 「在做：已开工」 is what this wrote when the turn had started but had no tool step yet; it
		// is filled in once with the first step (at most two writes per handoff).
		if it.WS == "" || it.Paused != "" || (status != boardHandedOff && status != boardStartedNoStep) {
			continue
		}
		if at, ok := tried[it.ID]; ok && now.Sub(at) < boardAutostartRetry {
			continue
		}
		since, ok := w.openHandoffSince(it)
		if !ok || !w.workspaceEventActive(it.WS, since) {
			continue
		}
		step := w.workspaceLastStep(it.WS, since)
		if status == boardStartedNoStep && step == "" {
			continue
		}
		tried[it.ID] = now
		status = "在做：" + boardAutostartStep(step)
		if out, err := e.runLeadScript(it.Chat, "board", "update", strconv.Itoa(it.ID), status); err != nil {
			slog.Warn("team watch: board autostart update failed", "board", it.ID, "workspace", it.WS, "error", err, "output", strings.TrimSpace(string(out)))
			continue
		}
		delete(tried, it.ID)
		slog.Info("team watch: workspace started; board item marked in progress", "board", it.ID, "workspace", it.WS, "status", status)
	}
}

// openHandoffSince: when the open handoff of item it's workspace began (false: none open).
func (w *handoffWatch) openHandoffSince(it teamTaskBoardItem) (time.Time, bool) {
	bound, _ := time.Parse(time.RFC3339Nano, it.Bound)
	path := teamWorkspacePath(w.e.dataDir)
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(path)
	hs := append([]TeamHandoff(nil), st.Handoffs[it.WS]...)
	teamWorkspaceStore.mu.Unlock()
	for i := len(hs) - 1; i >= 0; i-- {
		h := hs[i]
		if teamHandoffOpen(h) && !h.Idle.Returned && teamHandoffBelongsToItem(h, it, bound) {
			return h.At, true
		}
	}
	return time.Time{}, false
}

// workspaceLastStep: the latest tool step a turn of workspace key recorded at or after since
// (turn journal LastStep, "<tool> <input>"); "" when none yet.
func (w *handoffWatch) workspaceLastStep(key string, since time.Time) string {
	var best string
	var bestAt time.Time
	for _, x := range w.engines() {
		if x == nil {
			continue
		}
		j := x.turnJournalStore()
		if j == nil {
			continue
		}
		for _, en := range j.List() {
			if en.LastStep == "" || en.ProgressAt.Before(since) || !en.ProgressAt.After(bestAt) {
				continue
			}
			if _, ok := interactiveSessionInWorkspace(en.InteractiveKey, key); !ok {
				continue
			}
			best, bestAt = en.LastStep, en.ProgressAt
		}
	}
	return best
}

// workspaceLastEvent: the newest agent event of any session of workspace key (zero: none).
func (w *handoffWatch) workspaceLastEvent(key string) time.Time {
	var last int64
	for _, e := range w.engines() {
		if e == nil {
			continue
		}
		e.interactiveMu.Lock()
		for k, state := range e.interactiveStates {
			if _, ok := interactiveSessionInWorkspace(k, key); ok {
				if at := state.lastEventAt.Load(); at > last {
					last = at
				}
			}
		}
		e.interactiveMu.Unlock()
	}
	if last == 0 {
		return time.Time{}
	}
	return time.Unix(0, last)
}

func boardAutostartStep(step string) string {
	step = strings.Join(strings.Fields(step), " ")
	if step == "" {
		return boardNoStep
	}
	return truncateRunes(step, boardAutostartStepRunes)
}

// guardPromptPrefix: how board.py _guard_prompt opens the backstop timer prompt
// (contrib/gate/board.py「兜底到点：#<id>」).
const guardPromptPrefix = "兜底到点：#"

// withGuardLiveStatus: a backstop timer prompt gets the workspace's live state from team watch
// appended when it fires (busy or idle, last agent event, last step), so the lead does not judge
// the task by the board text alone. Other jobs are returned unchanged; the stored job is never
// modified.
func (e *Engine) withGuardLiveStatus(job *TimerJob, now time.Time) *TimerJob {
	if job == nil || !strings.HasPrefix(job.Prompt, guardPromptPrefix) {
		return job
	}
	rest := strings.TrimPrefix(job.Prompt, guardPromptPrefix)
	n := strings.IndexFunc(rest, func(r rune) bool { return r < '0' || r > '9' })
	if n < 0 {
		n = len(rest)
	}
	id, err := strconv.Atoi(rest[:n])
	if err != nil {
		return job
	}
	w := activeHandoffWatch.Load()
	if w == nil {
		w = newHandoffWatch(e)
	}
	line := w.guardLiveLine(id, now)
	if line == "" {
		return job
	}
	j := *job
	j.Prompt = job.Prompt + "\n" + line
	return &j
}

// guardLiveLine: one line of what team watch sees in the workspace of board item id right now;
// "" when the item is gone or not in a workspace.
func (w *handoffWatch) guardLiveLine(id int, now time.Time) string {
	it := w.e.boardItemByID(id)
	if it == nil || it.WS == "" {
		return ""
	}
	name := it.Who
	if name == "" {
		name = "工作区"
	}
	var b strings.Builder
	b.WriteString("桥实时查（看门同一套判断，以这里为准，别只看板上文字）：")
	if w.workspaceBusy(it.WS) {
		b.WriteString(name + "正在跑一轮")
	} else {
		b.WriteString(name + "现在没有在跑的一轮")
	}
	since, ok := w.openHandoffSince(*it)
	if last := w.workspaceLastEvent(it.WS); !last.IsZero() && (!ok || !last.Before(since)) {
		b.WriteString("，最近一次 agent 事件 " + teamTaskBoardAgo(last, now))
	} else {
		b.WriteString("，交活后还没有 agent 事件")
	}
	if ok {
		if step := w.workspaceLastStep(it.WS, since); step != "" {
			b.WriteString("，最近一步 " + boardAutostartStep(step))
		}
	}
	b.WriteString("。")
	return b.String()
}
