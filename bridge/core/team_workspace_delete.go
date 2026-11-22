package core

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

// TeamWorkspaceDeleter is implemented by platforms whose workspace channels the bridge can take
// out for good (cloud_web/DSH: the room leaves the channel list; Discord: the channel is deleted,
// #1788).
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
	_, err := e.deleteTeamWorkspace(workspace, false, "delete")
	return err
}

// deleteTeamWorkspace is DeleteTeamWorkspace; staleOwner also lets go of a workspace whose owner
// record has no task in work or paused there (the idle sweep, #1788: 工作区2–11 stayed owned with
// nothing open and were never reused). Before the channel goes, its records are archived
// (archiveTeamWorkspace, user 11-19「记录可以搞个日志系统压缩存起来」); no archive, no delete.
// After the platform deleted it, its pool record, handoffs and script watches go and the sessions
// of every role there are reset. Returns the archive path.
func (e *Engine) deleteTeamWorkspace(workspace string, staleOwner bool, why string) (string, error) {
	if e == nil || e.dataDir == "" || workspace == "" {
		return "", fmt.Errorf("team workspace delete: no workspace")
	}
	key := teamChatKey(workspace)
	plat, id, _ := strings.Cut(key, ":")
	d, ok := e.platformForName(plat).(TeamWorkspaceDeleter)
	if !ok {
		return "", fmt.Errorf("team workspace delete: %s: this platform cannot delete workspace channels", plat)
	}
	teamWorkspaceOpMu.Lock()
	defer teamWorkspaceOpMu.Unlock()
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(path)
	var inUse *TeamWorkspaceInUseError
	var rec teamWorkspaceRecords
	if err == nil {
		inUse = teamWorkspaceInUseLocked(st, plat, id, staleOwner)
		rec = teamWorkspaceRecordsLocked(st, plat, id)
	}
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		return "", fmt.Errorf("team workspace delete: %w", err)
	}
	if inUse != nil {
		return "", inUse
	}
	if staleOwner && teamTurnRunning(key) {
		return "", &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUseWorking, Detail: key + " has a turn running"}
	}
	if err := e.restoreWorkspaceHandoffModels(key); err != nil {
		return "", fmt.Errorf("team workspace delete: %s not deleted: %w", key, err)
	}
	ctx, cancel := context.WithTimeout(e.ctx, leadScriptTimeout) // 沿用 lead 脚本上限：存档要翻完频道历史
	defer cancel()
	archive, err := e.archiveTeamWorkspace(ctx, key, rec, why)
	if err != nil {
		return "", fmt.Errorf("team workspace delete: archive %s failed, not deleted: %w", key, err)
	}
	if err := d.DeleteTeamWorkspaceChannel(ctx, id); err != nil {
		_ = os.Remove(archive)
		if errors.Is(err, ErrTeamWorkspaceInUse) {
			return "", &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUseWorking, Detail: key + " is owned on the platform (a task is in work there)"}
		}
		return "", fmt.Errorf("team workspace delete: %w", err)
	}
	teamWorkspaceStore.mu.Lock()
	if st, err := loadTeamWorkspacesLocked(path); err == nil {
		teamWorkspaceForgetLocked(st, plat, id)
		err = saveTeamWorkspacesLocked(path, st)
		if err != nil {
			slog.Error("team workspace: deleted, but its records could not be dropped", "workspace", key, "error", err)
		}
	}
	teamWorkspaceStore.mu.Unlock()
	for _, x := range e.watchEngines() {
		x.ResetTeamWorkspaceSessions(key)
	}
	slog.Info("team workspace: deleted", "workspace", key, "name", rec.Name, "why", why, "archive", archive)
	return archive, nil
}

// teamWorkspaceForgetLocked drops every record of deleted workspace id of platform plat: the
// pool/ownership record, its handoffs and script watches (they are in the archive). Caller holds
// teamWorkspaceStore.mu.
func teamWorkspaceForgetLocked(st *teamWorkspaceState, plat, id string) {
	key := plat + ":" + id
	for parent := range st.Parents {
		if p, _, _ := strings.Cut(parent, ":"); p == plat {
			teamWorkspaceDropLocked(st, parent, id)
		}
	}
	delete(st.Handoffs, key)
	delete(st.ScriptWatches, key)
}

// teamWorkspacePausedStale: in the idle sweep a pause older than this no longer holds its
// workspace. 来源：#1793 现场 11-19：工作区2–5 被 11-12〜11-14 起再没动过的暂停活占着，工作区 6、7
// 被保留空闲留下，清扫 deleted=0。沿用十分钟看门以外最长的「隔天再看」节奏（等外部的活一般次日再看）。
// The task stays on the board; when it resumes it takes a free workspace, its records are in the
// archive.
const teamWorkspacePausedStale = 24 * time.Hour

// teamWorkspaceInUseLocked says why workspace id of platform plat cannot be deleted, nil when it
// is idle. staleOwner (the idle sweep): an owner record with no task in work there does not
// count, a pause quiet for teamWorkspacePausedStale does not count, and a paused task bound to no
// workspace holds only the workspace it was last handed to (#1793: one such task held every
// workspace it ever ran in). Caller holds teamWorkspaceStore.mu.
func teamWorkspaceInUseLocked(st *teamWorkspaceState, plat, id string, staleOwner bool) *TeamWorkspaceInUseError {
	key := plat + ":" + id
	if owner, _ := teamWorkspaceOwnerLocked(st, plat, id); owner != "" && !(staleOwner && teamWorkspaceNothingOpenLocked(st, key)) {
		return &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUseWorking, Detail: key + " belongs to " + owner + " now (a task is in work there)"}
	}
	now := time.Now()
	stale := func(t time.Time) bool { return staleOwner && now.Sub(t) >= teamWorkspacePausedStale }
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
			here := teamChatKey(t.SessionWS) == key || t.SessionWS == "" && (!staleOwner || teamTaskLastWorkspaceLocked(st, plat, h.Board) == key)
			if (t.State == TeamTaskPaused || t.State == TeamTaskAsking) && here && !stale(t.Since) {
				return &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUsePaused, Detail: fmt.Sprintf("task #%d is paused and continues in %s", h.Board, key)}
			}
		case i == len(hs)-1:
			// No task record: the workspace's last task was paused, not finished.
			if !stale(h.Parked) {
				return &TeamWorkspaceInUseError{Reason: TeamWorkspaceInUsePaused, Detail: "the last task of " + key + " is paused, not finished"}
			}
		}
	}
	return nil
}

// teamTaskLastWorkspaceLocked: the workspace of platform plat that board item n was last handed
// to. Caller holds teamWorkspaceStore.mu.
func teamTaskLastWorkspaceLocked(st *teamWorkspaceState, plat string, n int) string {
	var last time.Time
	ws := ""
	for key, hs := range st.Handoffs {
		if p, _, _ := strings.Cut(key, ":"); p != plat {
			continue
		}
		for _, h := range hs {
			if h.Board == n && !h.At.Before(last) {
				last, ws = h.At, key
			}
		}
	}
	return ws
}
