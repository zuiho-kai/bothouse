package core

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// TeamWorkspaceDeleter is implemented by platforms whose workspace channels the bridge can take
// out for good (cloud_web/DSH: the room leaves the channel list). On a platform without it the
// channel is deleted on the platform itself.
type TeamWorkspaceDeleter interface {
	// DeleteTeamWorkspaceChannel removes workspace channel workspaceID. The platform refuses one
	// it still records as owned (ErrTeamWorkspaceInUse).
	DeleteTeamWorkspaceChannel(ctx context.Context, workspaceID string) error
}

// ErrTeamWorkspaceInUse: the workspace cannot be deleted now. TeamWorkspaceInUseError says why.
var ErrTeamWorkspaceInUse = errors.New("workspace is in use")

// Why a workspace cannot be deleted (TeamWorkspaceInUseError.Reason, the delete API's "reason").
const (
	TeamWorkspaceInUseWorking = "working" // a task is in work there, or a chat channel just claimed it
	TeamWorkspaceInUsePaused  = "paused"  // a paused task waits to continue there
)

// TeamWorkspaceInUseError is ErrTeamWorkspaceInUse with its reason.
type TeamWorkspaceInUseError struct {
	Reason string
	Detail string
}

func (e *TeamWorkspaceInUseError) Error() string { return "team workspace delete: " + e.Detail }
func (e *TeamWorkspaceInUseError) Unwrap() error { return ErrTeamWorkspaceInUse }

// DeleteTeamWorkspace takes a free workspace ("<platform>:<id>") out for good (#1904: after the
// work is accepted, the idle workspaces can go). Only an idle one: a workspace a chat channel
// owns (a task in work, or one just handed to it: a queued task takes a workspace the moment it
// is free, and then it is owned) and one where a paused task waits to continue are refused with
// the reason; a paused task continues in the workspace it left, with the session saved there
// (restoreTeamTaskSession). The platform removes the channel; the bridge resets its sessions
// there. Runs under teamWorkspaceOpMu, so a claim cannot take the workspace in between.
func (e *Engine) DeleteTeamWorkspace(workspace string) error {
	if e == nil || e.dataDir == "" || workspace == "" {
		return fmt.Errorf("team workspace delete: no workspace")
	}
	key := teamChatKey(workspace)
	plat, id, _ := strings.Cut(key, ":")
	d, ok := e.platformForName(plat).(TeamWorkspaceDeleter)
	if !ok {
		return fmt.Errorf("team workspace delete: %s: workspace channels of this platform are deleted on the platform itself", plat)
	}
	teamWorkspaceOpMu.Lock()
	defer teamWorkspaceOpMu.Unlock()
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	var inUse *TeamWorkspaceInUseError
	if err == nil {
		inUse = teamWorkspaceInUseLocked(st, plat, id)
	}
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		return fmt.Errorf("team workspace delete: %w", err)
	}
	if inUse != nil {
		return inUse
	}
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	if err := d.DeleteTeamWorkspaceChannel(ctx, id); err != nil {
		if errors.Is(err, ErrTeamWorkspaceInUse) {
			return &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUseWorking, Detail: key + " is owned on the platform (a task is in work there)"}
		}
		return fmt.Errorf("team workspace delete: %w", err)
	}
	e.ResetTeamWorkspaceSessions(key)
	slog.Info("team workspace: deleted", "workspace", key)
	return nil
}

// teamWorkspaceInUseLocked says why workspace id of platform plat cannot be deleted, nil when it
// is idle. Caller holds teamWorkspaceStore.mu.
func teamWorkspaceInUseLocked(st *teamWorkspaceState, plat, id string) *TeamWorkspaceInUseError {
	key := plat + ":" + id
	if owner, _ := teamWorkspaceOwnerLocked(st, plat, id); owner != "" {
		return &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUseWorking, Detail: key + " belongs to " + owner + " now (a task is in work there)"}
	}
	hs := st.Handoffs[key]
	tasks := teamTasksOfLocked(st)
	for i, h := range hs {
		switch {
		case !h.Closed.IsZero():
		case h.Parked.IsZero():
			return &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUseWorking, Detail: key + " has a task in work"}
		case h.Board > 0:
			// The task's state is the record: paused here until it is handed off again or closed.
			t := tasks[h.Board]
			if (t.State == TeamTaskPaused || t.State == TeamTaskAsking) && (t.SessionWS == "" || teamChatKey(t.SessionWS) == key) {
				return &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUsePaused, Detail: fmt.Sprintf("task #%d is paused and continues in %s", h.Board, key)}
			}
		case i == len(hs)-1:
			// No task record: the workspace's last task was paused, not finished.
			return &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUsePaused, Detail: "the last task of " + key + " is paused, not finished"}
		}
	}
	return nil
}
