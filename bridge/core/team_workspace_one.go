package core

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// One task per workspace (user 2026-10-28, approved points 1-3 and「完成一件活的时候，自动清理」):
//   - a workspace's final [report] records pending verification and resets the session, which frees the
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
	runtimeDir, err := e.leadRuntimeDir()
	if err != nil {
		return nil, err
	}
	if runtimeDir != "" {
		bin = filepath.Join(runtimeDir, "lead", name)
	}
	var cmdArgs []string
	if _, err := os.Stat(bin); err == nil {
		cmdArgs = append([]string{bin}, args...)
		if runtime.GOOS == "windows" {
			// Windows cannot start an extensionless script: name the interpreter its shebang names.
			argv, werr := windowsLeadArgv(bin, e.leadPython())
			if werr != nil {
				return nil, werr
			}
			cmdArgs = append(argv, args...)
		}
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
			cmdArgs = append([]string{py, "-X", "utf8", "-I", gateBoard}, args...)
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
	if runtimeDir != "" {
		cmd.Env = append(cmd.Env, "GATE_DIR="+filepath.Join(runtimeDir, "gate"))
	}
	cmd.Dir = e.dataDir
	return cmd.CombinedOutput()
}

// leadPython is the interpreter the lead scripts run with on Windows: the product Python (its own
// directory is productPyBin there, holding python.exe), else the one FindPython picks (never the
// Microsoft Store stub, which is what `python3` on a stock Windows PATH is).
func (e *Engine) leadPython() string {
	if v, ok := e.productPyBin.Load().(string); ok && v != "" {
		for _, n := range []string{"python.exe", "python3.exe"} {
			if cand := filepath.Join(v, n); fileExists(cand) {
				return cand
			}
		}
	}
	if p, err := FindPython(); err == nil {
		return p
	}
	return "python"
}

// windowsLeadArgv turns a lead script into a command Windows can start. The python scripts
// (#!/usr/bin/env [-S] python3 [-I]) run as `py [-I] script`; board (a /bin/sh wrapper) runs
// gate/board.py the way the wrapper does. Other shell scripts need a POSIX shell and are refused.
func windowsLeadArgv(bin, py string) ([]string, error) {
	f, err := os.Open(bin)
	if err != nil {
		return nil, err
	}
	first, _ := bufio.NewReader(f).ReadString('\n')
	f.Close()
	first = strings.TrimSpace(first)
	if strings.HasPrefix(first, "#!") && strings.Contains(first, "python") {
		if strings.Contains(first, " -I") {
			return []string{py, "-X", "utf8", "-I", bin}, nil
		}
		return []string{py, "-X", "utf8", bin}, nil
	}
	if filepath.Base(bin) == "board" {
		// The ../gate runLeadScript also passes as GATE_DIR.
		return []string{py, "-X", "utf8", "-I", filepath.Join(filepath.Dir(bin), "..", "gate", "board.py")}, nil
	}
	return nil, fmt.Errorf("lead script %s needs a POSIX shell (%s), which Windows does not have", filepath.Base(bin), first)
}

// endWorkspaceTask runs after a workspace's [report]/[ask] headline for board item hid was
// posted in chat: a report records pending verification and resets the session after this turn (the reset
// frees the workspace); an ask pauses the item as waiting for the user and frees the workspace now.
func (e *Engine) endWorkspaceTask(chat, sessionKey, kind string, hid int, body string) {
	if hid <= 0 || !e.isTeamLead() {
		return
	}
	// A late exit may refer to a previous task after this workspace was reused.
	// Its delivery receipt can reconcile that task; it cannot reset or park the
	// session now executing a different, explicitly bound board item.
	current := e.boardItemByID(hid)
	for _, it := range readTeamTaskBoard(e.teamStatusDir()) {
		if it.ID != hid && it.WS != "" && teamChatKey(it.WS) == teamChatKey(sessionKey) &&
			it.Paused == "" && it.Backlog == "" && !watchBoardClosed(it) {
			// A failed board write can leave an older task bound after its
			// session was released. It must not block a newer binding's exit.
			if current != nil && teamChatKey(current.WS) == teamChatKey(sessionKey) {
				bound, err := time.Parse(time.RFC3339Nano, current.Bound)
				other, otherErr := time.Parse(time.RFC3339Nano, it.Bound)
				if err == nil && otherErr == nil && bound.After(other) {
					continue
				}
			}
			slog.Info("team workspace: late exit does not end another task", "board_item", hid, "active_item", it.ID, "session", sessionKey)
			return
		}
	}
	switch kind {
	case exitKindReport:
		if why, after, ok := waitExternalOf(body); ok {
			// blocked outside: paused as 「等外部」 with a retry time instead of 「已交回待验收」; the
			// workspace is freed and nothing wakes it before then (team_wait_external.go)
			e.parkWaitingExternal(chat, hid, why, after)
			return
		}
		reviewer := e.name
		if it := e.boardItemByID(hid); it != nil {
			bound, _ := time.Parse(time.RFC3339Nano, it.Bound)
			if h, ok := e.TeamHandoffOf(sessionKey, chat, bound); ok && h.Sender != "" {
				reviewer = h.Sender
			}
		}
		if out, err := e.runLeadScript(chat, "board", "returned", strconv.Itoa(hid), reviewer); err != nil {
			slog.Warn("team workspace: record handback failed", "board_item", hid, "error", err, "output", strings.TrimSpace(string(out)))
			// Delivery already succeeded. The persisted exit receipt lets the watcher
			// retry the board write; a script error must not keep this workspace occupied.
		} else {
			w := newHandoffWatch(e)
			w.engines = e.watchEngines
			w.reconcileTaskReviews(time.Now(), false)
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
//
// #497 核到的：这里只按 it.WS 绑定的板条目判断「还有没有活」，不看 it.ProgressAt，也不看
// 工作区最后一步 —— 那两样只在 team_task_board.go 的表格和「卡住」判定里读。所以一个状态被
// 误判成「已完成」的条目，工作区会在下一次整点对账（每 teamWorkspaceReconcileEvery 一次）
// 加 10 分钟宽限后被直接放回并 reset 会话。2026-11-09 15:07 那两次砍会话走的就是这条路径。
// #509 补上「最近还在动」的保护：绑定条目 teamTaskBoardLastActive 在 teamWorkspaceReconcileGrace
// 之内也当活的，跳过本轮回收。其余回收条件不变。
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
		if it.WS == "" || it.Paused != "" || it.Backlog != "" {
			continue
		}
		// A finished-looking item still keeps its workspace while the item itself moved
		// within the grace (ws-up report / board update / binding), so a wrong judgement
		// does not kill a workspace that is still working.
		if !watchBoardClosed(it) || now.Sub(teamTaskBoardLastActive(it, now)) < teamWorkspaceReconcileGrace {
			live[teamChatKey(it.WS)] = true
		}
	}
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(path)
	if err != nil {
		teamWorkspaceStore.mu.Unlock()
		slog.Error("team workspace reconcile: state unreadable; nothing released", "error", err)
		return nil
	}
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
