package core

import (
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Held for a central release (user 2026-11-04 「可以」 to: 集中发布前主动保存停点的活标「为发布暂停」，
// 发布切完自动续，不计失败). board hold marks the board item; while it is marked the idle watch neither
// counts the item's failed turns nor wakes it, and the board shows it under 等发布 instead of 卡住.
// The release ends with a bridge restart: the next process wakes each item that was marked before
// it started, from its saved stop point, and clears the mark. A release called off is undone by
// hand (board unhold).
type teamReleaseHold struct {
	At  string `json:"at"` // RFC 3339, as board.py wrote it; passed back verbatim to board unhold --at
	By  string `json:"by,omitempty"`
	Why string `json:"why,omitempty"`
}

// before: the mark was made before t (an unparsable time counts as before: it cannot be newer).
func (h *teamReleaseHold) before(t time.Time) bool {
	at, err := time.Parse(time.RFC3339Nano, h.At)
	return err != nil || at.Before(t)
}

// boardReleaseHeld: board item id is held for a release.
func (e *Engine) boardReleaseHeld(id int) bool {
	if e.team == nil || id == 0 {
		return false
	}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ID == id {
			return it.ReleaseHold != nil
		}
	}
	return false
}

// releaseHoldResumeDelay: wait after the first platform is ready before waking held items, so
// interrupted turns resume first (turn_resume.go) and a woken item is not handed a second turn.
// Source: 沿用 turnResumeStagger (one resume slot apart).
var releaseHoldResumeDelay = turnResumeStagger

// resumeReleaseHolds runs once per process: every item held before this process started is woken
// in the workspace that holds its handoff, by the engine that owns that handoff, and unmarked.
// Items no open handoff of this engine covers are left for the engine that owns them; the team
// lead unmarks the rest (nothing to wake: the normal watch takes them from there).
func (e *Engine) resumeReleaseHolds() {
	if e.team == nil || e.dataDir == "" || !e.sleepCtx(releaseHoldResumeDelay) {
		return
	}
	e.markDeployed()
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ReleaseHold == nil || !it.ReleaseHold.before(StartTime) {
			continue
		}
		a, ok := e.releaseHoldAssignment(it.ID)
		if !ok && !e.isTeamLead() {
			continue
		}
		chat := it.Chat
		if chat == "" {
			chat = it.SK
		}
		if err := releaseHoldUnhold(e, chat, it.ID, it.ReleaseHold.At); err != nil {
			slog.Warn("release hold: unhold failed", "board", it.ID, "error", err)
			continue
		}
		if !ok {
			slog.Info("release hold: cleared, no open handoff here", "board", it.ID)
			continue
		}
		// A fresh start for the resumed item: errors and wakes during the release do not count.
		h, saved := e.updateIdle(a, func(h *TeamHandoff) {
			h.Idle.Fails, h.Idle.Wakes, h.Idle.Reported, h.Idle.Returned = 0, 0, false, false
			h.Idle.Ended = time.Now()
		})
		if !saved {
			continue
		}
		a.h = h
		slog.Info("release hold: resuming", "board", it.ID, "workspace", a.key)
		e.sendIdleWake(a, h)
	}
}

// releaseHoldUnhold clears one release mark through board.py (it owns board.jsonl's lock); a
// variable so tests need no Python.
var releaseHoldUnhold = func(e *Engine, chat string, id int, at string) error {
	out, err := e.runLeadScript(chat, "board", "unhold", strconv.Itoa(id), "--at", at)
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// releaseHoldAssignment: this engine's open handoff (or script watch) for board item id.
func (e *Engine) releaseHoldAssignment(id int) (idleAssignment, bool) {
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	for _, script := range []bool{false, true} {
		all := st.Handoffs
		if script {
			all = st.ScriptWatches
		}
		for key, rows := range all {
			plat, _, _ := strings.Cut(key, ":")
			p := e.lookupReadyPlatform(plat)
			if p == nil {
				continue
			}
			for _, h := range rows {
				hid := h.Board
				if hid == 0 {
					hid = watchTaskNumber(h.Title)
				}
				if hid == id && teamHandoffOpen(h) && e.watchOwns(p, h.Owner) {
					return idleAssignment{key, h, script}, true
				}
			}
		}
	}
	return idleAssignment{}, false
}

// markDeployed: the team lead's check that merged items waiting on a release (AwaitDeploy) are in
// the build this bridge runs (CurrentCommit); board.py moves those to 待上线验收 and the review
// scan then assigns a non-author (user 2026-11-04 「可以」: 部署成功自动转「待上线验收」并派肥鱼验).
// Runs after a restart and on the hourly roundup (a failed GitHub lookup is retried there).
func (e *Engine) markDeployed() {
	commit := strings.TrimSpace(CurrentCommit)
	if e.team == nil || !e.isTeamLead() || !deployCommitRE.MatchString(commit) {
		return
	}
	waiting := false
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.AwaitDeploy != nil {
			waiting = true
			break
		}
	}
	if !waiting {
		return
	}
	if out, err := markDeployedRun(e, commit); err != nil {
		slog.Warn("release: board deployed failed", "commit", commit, "error", err, "output", string(out))
	}
}

// deployCommitRE: a git object name board deployed accepts (dev builds report "none" or "").
var deployCommitRE = regexp.MustCompile(`^[0-9a-f]{7,40}$`)

// markDeployedRun runs board deployed; a variable so tests need no Python or GitHub.
var markDeployedRun = func(e *Engine, commit string) ([]byte, error) {
	return e.runLeadScript(teamMainChat(e.dataDir), "board", "deployed", commit)
}
