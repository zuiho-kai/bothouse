package core

import (
	"fmt"
	"strings"
)

// taskOwnerOf is the chat channel a task belongs to ("<platform>:<id>"): the chat its board item
// was added for, and nothing else. board.py writes it when the task is added (a bare Discord id
// is read as discord:<id>) and only `board move` changes it. "" when the item has none.
//
// It is the one answer every path that posts a task's messages asks (the report, the watch's
// notices, the task's forum thread, a reply to an ended task). Before 11-25 each path picked its
// own: the item's chat, then the workspace's current owner, the session that ran the command, the
// handoff record's copy, sk or ch; when one was missing the next was taken without a word, and a
// month of misrouted posts (12 cases, Fable 11-25) came from those fallbacks. Board.py owner_chat
// is the same rule for the scripts.
func taskOwnerOf(it teamTaskBoardItem) string {
	c := strings.TrimSpace(it.Chat)
	if c == "" {
		return ""
	}
	if !strings.Contains(c, ":") {
		c = "discord:" + c
	}
	plat, id, _ := strings.Cut(chatOf(c), ":")
	if plat == "" || id == "" {
		return ""
	}
	return plat + ":" + id
}

// taskOwnerChat is taskOwnerOf for item, or why there is no answer: no item, no chat recorded, or
// the chat recorded is a workspace (an old row written by ws-handoff run inside one). A caller
// stops there; it does not fall back to another channel.
func (e *Engine) taskOwnerChat(it *teamTaskBoardItem) (string, error) {
	if it == nil {
		return "", fmt.Errorf("no task board item, so no owner chat")
	}
	c := taskOwnerOf(*it)
	if c == "" {
		return "", fmt.Errorf("task #%d has no owner chat on the board (fix it with: board move %d --to <chat session key>)", it.ID, it.ID)
	}
	if e.isWorkspaceKey(c) {
		return "", fmt.Errorf("task #%d names workspace %s as its owner chat (fix it with: board move %d --to <chat session key>)", it.ID, c, it.ID)
	}
	return c, nil
}

// handoffOwnerChat is the owner chat of the task a workspace handoff was for (h.Board). A
// handoff that names no board item has none: its chat copy is not taken (Fable 11-25: the handoff
// record, the workspace state and the board each kept a copy and nothing checked them).
func (e *Engine) handoffOwnerChat(h TeamHandoff) (string, error) {
	if h.Board <= 0 {
		return "", fmt.Errorf("handoff %q names no task board item, so no owner chat", h.Title)
	}
	it := e.boardItemByID(h.Board)
	if it == nil {
		return "", fmt.Errorf("task #%d of handoff %q is not on the board, so no owner chat", h.Board, h.Title)
	}
	return e.taskOwnerChat(it)
}

// isWorkspaceKey: key ("<platform>:<id>") is a channel the workspace state knows as a workspace.
func (e *Engine) isWorkspaceKey(key string) bool {
	if e == nil || e.dataDir == "" || key == "" {
		return false
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if err != nil {
		return false
	}
	return workspaceChannelKeysLocked(st)[teamChatKey(key)]
}
