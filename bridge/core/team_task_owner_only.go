package core

import (
	"errors"
	"log/slog"
	"strings"
)

// A workspace's task belongs to the role it was handed to (the handoff's Owner), not to whoever is
// called there. 11-27 #2094 (工作区6): 彩虹猫 worked the task; her progress quoted a test line with
// 鲸鱼娘's and 橘's @, both were woken, 橘 was cooling so the bridge handed the "mention" to 龙娘
// as work, and 龙娘 merged and handed the task back before 彩虹猫 had put it on line — the
// handback was refused at acceptance and the task ran a second round. Three gates now hold the
// task to its owner: another bot's @ in the workspace wakes no one but the owner (addresseeOf),
// a quota reassign does not hand on a mention in a workspace (quotaReassignMention), and only the
// owner hands the task back (WorkspaceExit).

// ErrWorkspaceExitNotOwner: the caller of the exit command is not the role working the task.
var ErrWorkspaceExitNotOwner = errors.New("the task in this workspace is not yours; only the role it was handed to hands it back")

// ownsHandoff: e is the role working handoff h — its Owner, the primary role when it names none,
// or, when the owner is a person, the role that handed it off (as worksWorkspaceTask decides).
func (e *Engine) ownsHandoff(p Platform, plat string, h TeamHandoff) bool {
	if e.watchOwns(p, h.Owner) {
		return true
	}
	return e.watchOwnerIsPerson(plat, h.Chat, h.Owner) && e.watchSender(h) == e
}

// workspaceOpenHandoff returns the handoff in work in workspace session: the one of task-board
// item board when board > 0, else the newest. false: none is in work there.
func (e *Engine) workspaceOpenHandoff(session string, board int) (TeamHandoff, bool) {
	if e == nil || e.dataDir == "" || session == "" {
		return TeamHandoff{}, false
	}
	key := teamChatKey(session)
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		slog.Error("team workspace: state unreadable", "channel", key, "error", err)
		return TeamHandoff{}, false
	}
	var out TeamHandoff
	found := false
	for _, h := range st.Handoffs[key] {
		if !teamHandoffOpen(h) || (board > 0 && h.Board != board) {
			continue
		}
		out, found = h, true
	}
	return out, found
}

// notWorkspaceOwner: session is a workspace with a task in work and e is not the role working it.
func (e *Engine) notWorkspaceOwner(p Platform, session string, board int) bool {
	h, ok := e.workspaceOpenHandoff(session, board)
	if !ok {
		return false
	}
	plat, _, _ := strings.Cut(teamChatKey(session), ":")
	if p == nil {
		p = e.lookupReadyPlatform(plat)
	}
	return !e.ownsHandoff(p, plat, h)
}
