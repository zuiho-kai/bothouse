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
// whose card lives in the source workspace sourceSessionKey. Task cards only
// live in workspace channels (#453), so a cross-workspace dispatch goes from
// workspace A (card, reports and watch stay on A's card) to another workspace
// B of the same chat channel: WorkspaceParent(A) == WorkspaceParent(B). B must
// already be claimed (claim it first). The claim itself records one handoff in
// work, so B is busy only when it has more than teamWorkspaceBusy in work: the
// claim for this dispatch plus some other task. A second claim of B by the same
// chat channel is not refused (ClaimTeamWorkspaceFor only refuses other
// channels), so a claim made for another task still lets this dispatch in;
// closing that gap needs the task id recorded on the claim. It returns the
// normalized "<platform>:<workspace id>" key.
func (e *Engine) resolveTaskWorkspace(sourceSessionKey, workspace string) (string, error) {
	platform, wsID, err := taskWorkspaceChannelKey(sourceSessionKey, workspace)
	if err != nil {
		return "", err
	}
	_, sourceID, err := parseSessionKeyParts(sourceSessionKey)
	if err != nil {
		return "", fmt.Errorf("source session: %w", err)
	}
	sourceParent, ok := e.WorkspaceParent(platform + ":" + sourceID)
	if !ok {
		return "", errors.New("source session is not a workspace of a chat channel; dispatch from a workspace")
	}
	parent, ok := e.WorkspaceParent(platform + ":" + wsID)
	if !ok {
		return "", fmt.Errorf("workspace %q is not a recorded workspace of this chat; claim it first", wsID)
	}
	if parent != sourceParent {
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
