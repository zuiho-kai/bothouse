package core

import (
	"fmt"
	"log/slog"
	"strings"
)

// sendTaskOf is the board item a `bothouse send` is for: the one it names (--for, else the
// delivery's --board-id or --mention-assigner), else, for a process started on a workspace task
// (CC_HANDOFF), that handoff's board item. 0 when the send names no task (a lead talking in its own
// chat, a user conversation): those keep going where they are sent.
func (e *Engine) sendTaskOf(named, board, assigner int, from, target, handoff string) int {
	for _, id := range []int{named, board, assigner} {
		if id > 0 {
			return id
		}
	}
	if handoff == "" {
		return 0
	}
	for _, key := range []string{from, target} {
		if key == "" {
			continue
		}
		if h, ok := e.workspaceHandoffByID(teamChatKey(key), handoff); ok && h.Board > 0 {
			return h.Board
		}
	}
	return 0
}

// workspaceHandoffByID: the handoff of workspace key whose id (teamHandoffID) is id.
func (e *Engine) workspaceHandoffByID(key, id string) (TeamHandoff, bool) {
	if e == nil || e.dataDir == "" || key == "" || id == "" {
		return TeamHandoff{}, false
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if err != nil {
		return TeamHandoff{}, false
	}
	for _, h := range st.Handoffs[key] {
		if teamHandoffID(h) == id {
			return h, true
		}
	}
	return TeamHandoff{}, false
}

// sendTaskTargetProblem: why a send for task id may not go to target ("" when it may). The
// bridge decides where a task's messages go, not the sender: target must be the task's owner chat
// (taskOwnerChat), the task's own forum thread, or a workspace channel (the working room, not a
// user's channel). An owner that cannot be told, or another chat, is refused unless cross: the
// sender says on purpose that this one goes elsewhere (`send --cross-channel`). The rule sits in
// the bridge, so text, links and attachments are all held to it, through the CLI or the API.
//
// Before, `send -s <chat>` went wherever the sender wrote (11-11: a summary for jiuwen went to
// b站运营), and the only check (#2208) guessed a file's task from the folder it sat in.
func (e *Engine) sendTaskTargetProblem(id int, target string, cross bool) string {
	if id <= 0 || target == "" || cross {
		return ""
	}
	if e.teamStatusDir() == "" {
		return "" // no task board on this install: a --board-id only labels the files, there is no owner to hold it to
	}
	tchat := teamChatKey(target)
	if e.isWorkspaceKey(tchat) {
		return ""
	}
	it := e.boardItemByID(id)
	owner, err := e.taskOwnerChat(it)
	if err != nil {
		slog.Warn("send: refused, the task's owner chat is unknown", "board_item", id, "target", tchat, "error", err)
		return fmt.Sprintf("not sent: #%d has no owner chat the bridge can check against (%v). "+
			"Fix the task with board move, or, if this message really belongs in %s, send again with --cross-channel.", id, err, tchat)
	}
	if owner == tchat || taskPostThread(it.Post) == teamChannelID(tchat) && teamChannelID(tchat) != "" {
		return ""
	}
	slog.Warn("send: refused, target is not the task's owner chat", "board_item", id, "target", tchat, "owner", owner)
	return fmt.Sprintf("not sent: #%d belongs to %s, not %s. Send it without -s/--channel (the bridge posts it to the task's chat), "+
		"or, if it really belongs in %s, send again with --cross-channel.", id, owner, tchat, tchat)
}

// taskPostThread: the thread id of a task's forum post link (…/channels/<guild>/<thread>[/<msg>]).
func taskPostThread(post string) string {
	_, rest, ok := strings.Cut(strings.TrimSpace(post), "/channels/")
	if !ok {
		return ""
	}
	parts := strings.Split(rest, "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}
