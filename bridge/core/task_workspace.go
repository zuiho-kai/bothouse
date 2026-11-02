package core

import (
	"errors"
	"fmt"
	"strings"
)

// taskWorkspaceChannelKey validates that workspace is a selector on the same
// platform as sourceSessionKey and returns its platform and channel id. It does
// not check ownership or occupancy: a retry of a committed dispatch must still
// match its receipt after the workspace changes hands, while a new dispatch is
// checked against the live workspace record by resolveTaskWorkspace.
func taskWorkspaceChannelKey(sourceSessionKey, workspace string) (platform, wsID string, err error) {
	platform, _, err = parseSessionKeyParts(sourceSessionKey)
	if err != nil {
		return "", "", fmt.Errorf("source session: %w", err)
	}
	ws := strings.TrimSpace(workspace)
	if ws == "" {
		return "", "", errors.New("workspace is required")
	}
	if !strings.Contains(ws, ":") {
		ws = platform + ":" + ws
	}
	wsPlatform, wsID, err := parseSessionKeyParts(ws)
	if err != nil || wsPlatform != platform || wsID == "" {
		return "", "", fmt.Errorf("workspace %q is not on platform %s", workspace, platform)
	}
	return platform, wsID, nil
}

// resolveTaskWorkspace validates an explicit execution workspace for a task
// owned by sourceSessionKey. The source may be a workspace A or the chat
// channel that owns the workspaces. Task cards only live in workspace channels
// (#453), so a dispatch from a workspace A goes to a sibling workspace B of the
// same chat (WorkspaceParent(A) == WorkspaceParent(B)); a dispatch from the
// chat channel goes to one of its own workspaces (Parent(B) == chat). B must
// already be claimed (claim it first) and have fewer than teamWorkspaceBusy
// tasks in work. It returns the normalized "<platform>:<workspace id>" key.
func (e *Engine) resolveTaskWorkspace(sourceSessionKey, workspace string) (string, error) {
	platform, wsID, err := taskWorkspaceChannelKey(sourceSessionKey, workspace)
	if err != nil {
		return "", err
	}
	_, sourceID, err := parseSessionKeyParts(sourceSessionKey)
	if err != nil {
		return "", fmt.Errorf("source session: %w", err)
	}
	sourceChannel := platform + ":" + sourceID
	sourceChat, isWorkspace := e.WorkspaceParent(sourceChannel)
	if !isWorkspace {
		// The source is the chat channel itself, not one of its workspaces.
		sourceChat = teamChatKey(sourceChannel)
		if len(e.TeamWorkspacesOf(sourceChat)) == 0 {
			return "", errors.New("source session is not a workspace or a chat channel with workspaces; dispatch from a workspace or a chat channel")
		}
	}
	parent, ok := e.WorkspaceParent(platform + ":" + wsID)
	if !ok {
		return "", fmt.Errorf("workspace %q is not a recorded workspace of this chat; claim it first", wsID)
	}
	if parent != sourceChat {
		return "", fmt.Errorf("workspace %q belongs to another chat channel", wsID)
	}
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	open, _ := teamWorkspaceCountsLocked(st, platform+":"+wsID)
	teamWorkspaceStore.mu.Unlock()
	if open > teamWorkspaceBusy {
		return "", fmt.Errorf("workspace %q is busy (%d tasks in work)", wsID, open)
	}
	return platform + ":" + wsID, nil
}

// taskReporterSessions lists the channels a task reporter must be bound in: the
// source session that receives its facts and, for a cross-workspace dispatch,
// the workspace it executes in.
func taskReporterSessions(source, exec string) []string {
	if exec == "" || exec == source {
		return []string{source}
	}
	return []string{source, exec}
}
