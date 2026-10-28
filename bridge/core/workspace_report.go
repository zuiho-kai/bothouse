package core

import (
	"fmt"
	"log/slog"
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
		if teamChatKey(owner) != teamChatKey(key) || it.AutoPruned != "" {
			continue
		}
		who := whoInWorkspace(it)
		if who != e.name && who != e.DisplayName() {
			continue
		}
		if it.DoneAt != "" || teamTaskBoardWaitUser.MatchString(it.Status) {
			out[it.ID] = it.Status + "\n" + it.DoneAt
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
	kind, body, valid := parseExitKind(text)
	if valid && kind == exitKindAsk {
		valid = askEvidenceProblems(body) == nil
	}
	if kind == "" && strings.TrimSpace(text) != "" && e.workspaceHasOpenHandoff(key) {
		valid = true // forwardWorkspaceExit sent this unmarked reply back as a [report]
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
	if wake {
		slog.Warn("workspace report missing: preserving session and requesting delivery", "session", key)
		e.wakeWatchRole(key, fmt.Sprintf("你把活标成完成或等用户，但没交 [report]。保留当前会话，请立即补交上一轮的结果；最后一条回复第一行写 [report]，正文写交付内容和证据，让聊天频道收到。需要用户决定时用带自验证据和类别的 [ask]。不要重新做已经完成的工作。原会话：%s", key), "补交工作区结果")
	} else {
		slog.Error("workspace report recovery exhausted; session reset remains blocked", "session", key)
	}
	return true
}
