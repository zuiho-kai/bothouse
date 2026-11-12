package core

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"
)

// Per-turn board snapshots distinguish a new completion from an older item
// already waiting for the user. A missing report keeps a queued reset blocked
// until the recovery turn delivers its report or question.
type workspaceReportTurn struct {
	board    map[int]string
	valid    bool
	required bool
	wakes    int
}

func (e *Engine) workspaceReportBoard(key string) map[int]string {
	out := make(map[int]string)
	if e.team == nil {
		return out
	}
	parent, _ := e.workspaceParent(teamChatKey(key))
	wsName := e.TeamWorkspaceName(key)
	items := append(readTeamTaskBoard(e.team.dir), readTeamTaskBoardFile(e.team.dir, teamTaskBoardDoneFile)...)
	for _, it := range placeTeamTaskBoard(e.teamTaskBoardPlacer(), items) {
		owner := it.WS
		if owner == "" {
			owner = it.SK
		}
		if owner == "" && it.Ch != "" {
			owner = "discord:" + it.Ch
			// Older ws-handoff rows identify the workspace by its name in
			// who, while ch still points to the parent chat.
			if parent != "" && teamChatKey(owner) == teamChatKey(parent) &&
				wsName != "" && strings.HasPrefix(it.Who, wsName) {
				owner, it.wsName = key, wsName
			}
		}
		if teamChatKey(owner) != teamChatKey(key) || it.AutoPruned != "" || it.Backlog != "" {
			continue
		}
		who := whoInWorkspace(it)
		if who != e.name && who != e.DisplayName() {
			continue
		}
		if it.DoneAt != "" || teamTaskBoardWaitUser.MatchString(it.Status) {
			out[it.ID] = it.Status + "\n" + it.DoneAt
		} else if it.PauseReq != "" && it.DoneAt == "" && it.Paused == "" {
			// stopped itself this turn (board.py self_pause): a report is owed like for a done item
			out[it.ID] = selfPauseMark + it.PauseReq
		}
	}
	return out
}

func (e *Engine) beginWorkspaceReportTurn(key string) {
	if _, ok := e.workspaceParent(teamChatKey(key)); !ok {
		if _, ok := e.workspaceParent(sessionChannel(key)); !ok {
			return
		}
	}
	board := e.workspaceReportBoard(key)
	e.pendingResetMu.Lock()
	defer e.pendingResetMu.Unlock()
	if e.workspaceReports == nil {
		e.workspaceReports = make(map[string]*workspaceReportTurn)
	}
	r := e.workspaceReports[key]
	if r == nil {
		r = &workspaceReportTurn{}
		e.workspaceReports[key] = r
	}
	r.board, r.valid = board, false
}

// finishWorkspaceReportTurn returns true when recovery owns this terminal
// event, so the generic idle watcher cannot queue a duplicate continuation.
func (e *Engine) finishWorkspaceReportTurn(key, text string) bool {
	board := e.workspaceReportBoard(key)
	kind, body, valid := parseExitKindTurn(text)
	if valid && kind == exitKindAsk {
		valid = askEvidenceProblems(body) == nil
	}
	e.pendingResetMu.Lock()
	r := e.workspaceReports[key]
	if r == nil {
		e.pendingResetMu.Unlock()
		return false
	}
	changed := false
	for id, status := range board {
		if r.board[id] != status {
			changed = true
			break
		}
	}
	r.board, r.valid = board, valid
	if valid {
		r.required, r.wakes = false, 0
		e.pendingResetMu.Unlock()
		return false
	}
	r.required = r.required || changed || e.pendingReset[key]
	if !r.required {
		e.pendingResetMu.Unlock()
		return false
	}
	// Match the existing idle watcher: two attempts, then stop re-enqueuing.
	wake := r.wakes < 2
	r.wakes++
	e.pendingResetMu.Unlock()
	if id, why := selfPauseOf(board); id > 0 {
		if wake {
			slog.Warn("workspace stopped itself without a report: requesting delivery", "session", key, "board_item", id)
			e.wakeWatchRole(key, fmt.Sprintf("你在工作区里给 #%d 记了停手（%s），但这一轮没交 [report]。保留当前会话，现在交回：把 [report] #%d 写进草稿文件（说做到哪、卡在哪、要谁定，第二行起写已核实的产物和证据），跑 ws-up --report <草稿文件>。不要再跑新命令，不要重做已完成的工作。", id, why, id), "补交停手汇报")
			return true
		}
		e.selfPauseFallback(key, id, why, text)
		return true
	}
	if wake {
		slog.Warn("workspace report missing: preserving session and requesting delivery", "session", key)
		e.wakeWatchRole(key, fmt.Sprintf("你把活标成完成或等用户，但没交 [report]。保留当前会话，请立即补交上一轮的结果；把 [report] #任务板编号 给用户的一两句话写进草稿文件，第二行起写交付内容和证据，跑 ws-up --report <草稿文件> 交回。需要用户决定时跑带自验证据和类别的 ws-up --ask。不要重新做已经完成的工作。原会话：%s", key), "补交工作区结果")
	} else {
		slog.Error("workspace report recovery exhausted; session reset remains blocked", "session", key)
	}
	return true
}

const selfPauseMark = "pause_req\n"

// selfPauseOf returns the board item the workspace asked to stop on (board.py self_pause) and
// why, from a workspaceReportBoard snapshot; 0 when none.
func selfPauseOf(board map[int]string) (int, string) {
	best := 0
	for id, v := range board {
		if strings.HasPrefix(v, selfPauseMark) && (best == 0 || id < best) {
			best = id
		}
	}
	if best == 0 {
		return 0, ""
	}
	return best, strings.TrimPrefix(board[best], selfPauseMark)
}

// selfPauseFallback: the workspace stopped itself (board.py self_pause) and still wrote no
// [report] after the wakes. Its last words go to the chat channel's lead as the pause note (agentm
// #26, 11-09: the result never reached the chat), and then the task is paused for real from the
// chat side, which parks the workspace and resets its session.
func (e *Engine) selfPauseFallback(key string, id int, why, text string) {
	parent, ok := e.workspaceParent(teamChatKey(key))
	if !ok {
		parent, ok = e.workspaceParent(sessionChannel(key))
	}
	if !ok {
		slog.Error("workspace self-pause: no chat channel; nothing posted", "session", key, "board_item", id)
		return
	}
	plat, _, _ := strings.Cut(teamChatKey(key), ":")
	p := e.platformForName(plat)
	note := strings.TrimSpace(stripFillerLines(text))
	if note == "" {
		note = "（这一轮最后没说话）"
	}
	body := fmt.Sprintf("工作区自己停手（#%d）：%s\n最后一段话：\n%s", id, why, note)
	chatID := parent
	if _, cid, full := strings.Cut(parent, ":"); full {
		chatID = cid
	}
	posted := false
	if p != nil {
		posted = e.wakeChatLeadContext(e.ctx, p, chatID, sessionChannel(key), e.exitBotName(), exitKindReport, body, key, id, false, "")
	}
	slog.Warn("workspace self-pause: no report after the wakes; last words handed to the chat lead", "session", key, "board_item", id, "handed", posted)
	chat := parent
	if !strings.Contains(chat, ":") {
		chat = plat + ":" + chat
	}
	if out, err := e.runLeadScript(chat, "board", "pause", strconv.Itoa(id), "工作区自己停手："+why); err != nil {
		slog.Warn("workspace self-pause: board pause failed", "board_item", id, "error", err, "output", strings.TrimSpace(string(out)))
	}
}
