package core

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// One task per workspace (user 2026-10-28, approved points 1-3 and「完成一件活的时候，自动清理」):
//   - a workspace's final [report] closes its board item and resets the session, which frees the
//     workspace (releaseWorkspaceOnReset);
//   - an [ask] pauses its board item as waiting for the user and frees the workspace; the user's
//     answer hands the task to a free workspace again (ws-handoff --resume);
//   - a freed workspace takes the next queued task (ws-handoff --drain);
//   - once an hour a workspace whose tasks are no longer live on the board is freed.
// The board itself is written by the lead scripts (contrib/gate/board.py through
// <dataDir>/collaboration/lead), which own its lock and fields.

const (
	teamWorkspaceReconcileEvery = time.Hour
	// teamWorkspaceReconcileGrace: a handoff this young is left alone; ws-handoff claims the
	// workspace a moment before it binds the board item.
	teamWorkspaceReconcileGrace = 10 * time.Minute
	leadScriptTimeout           = 2 * time.Minute
)

// runLeadScript runs <dataDir>/collaboration/lead/<name> args… as chat's lead would.
// When collaboration/lead is not installed yet, "board" falls back to <dataDir>/gate/board.py
// (installed by GateSupervisor or GateScriptFS) so workspace [report]/[ask] still update the board.
func (e *Engine) runLeadScript(chat, name string, args ...string) ([]byte, error) {
	if e == nil || e.dataDir == "" {
		return nil, os.ErrNotExist
	}
	bin := filepath.Join(e.dataDir, "collaboration", "lead", name)
	var cmdArgs []string
	if _, err := os.Stat(bin); err == nil {
		cmdArgs = append([]string{bin}, args...)
	} else if name == "board" {
		gateBoard := filepath.Join(e.dataDir, "gate", "board.py")
		if _, gerr := os.Stat(gateBoard); gerr != nil && GateScriptFS != nil {
			_ = installGateScripts(filepath.Join(e.dataDir, "gate"))
		}
		if _, gerr := os.Stat(gateBoard); gerr == nil {
			py := "python3"
			if v := e.productPyBin.Load(); v != nil {
				if dir, _ := v.(string); dir != "" {
					if cand := filepath.Join(dir, "python3"); fileExists(cand) {
						py = cand
					}
				}
			} else if cand := filepath.Join(AgentToolsDir(e.dataDir), "bin", "python3"); fileExists(cand) {
				py = cand
			}
			cmdArgs = append([]string{py, "-I", gateBoard}, args...)
		} else {
			return nil, err
		}
	} else {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(e.ctx, leadScriptTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, cmdArgs[0], cmdArgs[1:]...)
	cmd.Env = append(os.Environ(), e.roleSessionEnv(chat)...)
	cmd.Dir = e.dataDir
	return cmd.CombinedOutput()
}

// endWorkspaceTask runs after a workspace's [report]/[ask] headline for board item hid was
// posted in chat: a report closes the item and resets the session after this turn (the reset
// frees the workspace); an ask pauses the item as waiting for the user and frees the workspace now.
func (e *Engine) endWorkspaceTask(chat, sessionKey, kind string, hid int) {
	if hid <= 0 || !e.isTeamLead() {
		return
	}
	switch kind {
	case exitKindReport:
		if out, err := e.runLeadScript(chat, "board", "update", strconv.Itoa(hid), "已完成"); err != nil {
			slog.Warn("team workspace: close reported task failed", "board_item", hid, "error", err, "output", strings.TrimSpace(string(out)))
		}
		if _, err := e.QueueSessionReset(sessionKey); err != nil {
			slog.Warn("team workspace: reset after report failed", "session", sessionKey, "error", err)
		}
	case exitKindAsk:
		// Off the turn's goroutine: freeing the workspace resets this very session (bridge API).
		go func() {
			if out, err := e.runLeadScript(chat, "board", "ask", strconv.Itoa(hid)); err != nil {
				slog.Warn("team workspace: yield on ask failed", "board_item", hid, "error", err, "output", strings.TrimSpace(string(out)))
			}
		}()
	}
}

// resumeAskedTask hands the user's answer for board item hid to a free workspace when the asking
// workspace was given up while waiting (board item paused as waiting for the user). false: the
// task still holds its workspace (or the hand-off failed), so the answer goes there as before.
func (e *Engine) resumeAskedTask(chat string, hid int, answer string) bool {
	if hid <= 0 || e.team == nil {
		return false
	}
	waiting := false
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ID == hid {
			waiting = it.Paused != "" && it.WS == "" && teamTaskBoardWaitUser.MatchString(it.PauseWhy)
		}
	}
	if !waiting {
		return false
	}
	out, err := e.runLeadScript(chat, "ws-handoff", "--resume", strconv.Itoa(hid), answer)
	if err != nil {
		slog.Warn("team workspace: resume after answer failed", "board_item", hid, "error", err, "output", strings.TrimSpace(string(out)))
		return false
	}
	slog.Info("team workspace: answered task handed to a workspace again", "board_item", hid, "chat", chat)
	return true
}

// drainTeamWorkspaceQueue starts the next queued task once a workspace of chat's pool is free.
func (e *Engine) drainTeamWorkspaceQueue(chat string) {
	if chat == "" || !e.isTeamLead() {
		return
	}
	go func() {
		if out, err := e.runLeadScript(chat, "ws-handoff", "--drain"); err != nil && !os.IsNotExist(err) {
			slog.Warn("team workspace: queue drain failed", "chat", chat, "error", err, "output", strings.TrimSpace(string(out)))
		}
	}()
}

// reconcileTeamWorkspaces frees every workspace that holds handoffs but no live board item: an
// item bound to it (ws) that is neither paused nor finished. Finished, paused or missing items
// do not keep a workspace busy; a stuck item is still bound and keeps it. Returns the freed keys.
func (w *handoffWatch) reconcileTeamWorkspaces(now time.Time) []string {
	e := w.e
	if e == nil || e.dataDir == "" || e.team == nil {
		return nil
	}
	if _, err := os.Stat(filepath.Join(e.team.dir, teamTaskBoardFile)); err != nil {
		return nil // no board here: nothing to compare with
	}
	live := map[string]bool{}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.WS != "" && it.Paused == "" && !watchBoardClosed(it) {
			live[teamChatKey(it.WS)] = true
		}
	}
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(path)
	var stale []string
	for key, list := range st.Handoffs {
		if live[key] {
			continue
		}
		plat, _, _ := strings.Cut(key, ":")
		if owner, _ := teamWorkspaceOwnerLocked(st, plat, teamChannelID(key)); owner == "" {
			continue
		}
		open, young := false, false
		for _, h := range list {
			if teamHandoffOpen(h) {
				open = true
				young = young || now.Sub(h.At) < teamWorkspaceReconcileGrace
			}
		}
		if open && !young {
			stale = append(stale, key)
		}
	}
	teamWorkspaceStore.mu.Unlock()
	var freed []string
	for _, key := range stale {
		if !e.releaseTeamWorkspace(key, now, false) {
			continue
		}
		for _, x := range w.engines() {
			x.ResetTeamWorkspaceSessions(key)
		}
		slog.Info("team workspace: freed, no live board item there", "workspace", key)
		freed = append(freed, key)
	}
	return freed
}
