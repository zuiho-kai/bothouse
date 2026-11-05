package core

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
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

// before: the mark was made before t. An unparsable time is not before anything: it cannot be
// told apart from a mark made for the coming release, so it is left for board unhold (#984 review:
// counting it as old woke and cleared a fresh mark).
func (h *teamReleaseHold) before(t time.Time) bool {
	at, err := time.Parse(time.RFC3339Nano, h.At)
	return err == nil && at.Before(t)
}

// activeReleaseHold: the item is held for a release that has not happened yet. A mark made
// before this process started belongs to a release already done (the restart is the release):
// it no longer holds the watch, even while resumeReleaseHolds has not cleared it yet.
func activeReleaseHold(it teamTaskBoardItem) bool {
	return it.ReleaseHold != nil && !it.ReleaseHold.before(StartTime)
}

// handoffBoardID: the board item a workspace handoff works on. h.Board when recorded; else the
// one open item bound to the workspace (board add ws=<key>, written right after the claim — the
// claim itself only carries the task sentence, ws-handoff claim_cmd); a #N in the title counts
// only when it names an item bound to that workspace, an unbound legacy item, or an item handed
// off from that channel (a chat-channel watch), so an issue or
// PR number in the title (「发布 #984 收尾」) cannot match another workspace's item (#984 review).
func handoffBoardID(key string, h TeamHandoff, items []teamTaskBoardItem) int {
	if h.Board > 0 {
		return h.Board
	}
	n := handoffTitleNumber(h.Title)
	bound, legacy := 0, 0
	count := 0
	for _, it := range items {
		ws := teamChatKey(it.WS)
		if ws == key {
			count++
			if bound == 0 || it.ID == n {
				bound = it.ID
			}
		}
		if n != 0 && it.ID == n && (it.WS == "" || it.Chat != "" && chatOf(it.Chat) == key) {
			legacy = n
		}
	}
	switch {
	case count == 1 || count > 1 && bound == n:
		return bound
	case count > 1:
		return 0 // several items on one workspace and the title names none of them: unknown
	}
	return legacy
}

// handoffTitleNumber: the board id a handoff title names, only when the title starts with it
// ("#7 集中发布", the form the claim writes). A number inside a sentence (「发布 #984 收尾」) is an
// issue or PR number, not the item this handoff works on (#984 review).
func handoffTitleNumber(title string) int {
	t := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(title), "【接】"))
	if !strings.HasPrefix(t, "#") {
		return 0
	}
	n := watchTaskNumber(t)
	if n == 0 || !strings.HasPrefix(t, "#"+strconv.Itoa(n)) {
		return 0
	}
	return n
}

// boardReleaseHeld: the board item of handoff h in workspace key is held for a coming release.
func (e *Engine) boardReleaseHeld(key string, h TeamHandoff) bool {
	if e.team == nil {
		return false
	}
	items := readTeamTaskBoard(e.team.dir)
	id := handoffBoardID(key, h, items)
	if id == 0 {
		return false
	}
	for _, it := range items {
		if it.ID == id {
			return activeReleaseHold(it)
		}
	}
	return false
}

// releaseHoldResumeDelay: wait after the first platform is ready before waking held items, so
// interrupted turns resume first (turn_resume.go) and a woken item is not handed a second turn.
// Source: 沿用 turnResumeStagger (one resume slot apart).
var releaseHoldResumeDelay = turnResumeStagger

// releaseHoldRetryEvery: how often an item that could not be resumed yet is tried again (its
// workspace's platform not ready, the workspace busy, the mark not cleared).
// Source: 沿用 teamWorkspaceReconcileEvery (the hourly roundup that already re-checks the board).
var releaseHoldRetryEvery = teamWorkspaceReconcileEvery

// releaseHoldMu: one pass at a time across the engines of this process (each engine runs its
// own pass for its own handoffs; the team lead's pass also clears marks nobody covers).
var releaseHoldMu sync.Mutex

// releaseHoldMisses: marks whose item has no open handoff, counted per pass. The first pass only
// says so and keeps the mark (a handoff of another engine may not be loaded yet); a mark still
// uncovered on the next pass is cleared (#984 review: not deleting it on the first miss).
var releaseHoldMisses = map[string]int{}

// resumeReleaseHolds runs once per engine, after its first platform is ready: every item held
// before this process started is woken in the workspace that holds its handoff, by the engine
// that owns that handoff, and then unmarked. What cannot be done yet is retried every
// releaseHoldRetryEvery until nothing of this engine's is left.
func (e *Engine) resumeReleaseHolds() {
	if e.team == nil || e.dataDir == "" || !e.sleepCtx(releaseHoldResumeDelay) {
		return
	}
	for e.resumeReleaseHoldsPass() > 0 {
		if !e.sleepCtx(releaseHoldRetryEvery) {
			return
		}
	}
}

// resumeReleaseHoldsPass handles every mark made before this process; it returns how many are
// left for this engine to retry.
func (e *Engine) resumeReleaseHoldsPass() int {
	releaseHoldMu.Lock()
	defer releaseHoldMu.Unlock()
	left := 0
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if it.ReleaseHold == nil || !it.ReleaseHold.before(StartTime) {
			continue
		}
		chat := it.Chat
		if chat == "" {
			chat = it.SK
		}
		a, ok := e.releaseHoldAssignment(it.ID)
		if !ok {
			if !e.isTeamLead() || e.releaseHoldCovered(it.ID) {
				continue // another engine's handoff (or one not ready yet): its own pass resumes it
			}
			// Nobody holds a handoff for it: nothing to wake. Say so once and keep the mark for
			// the next pass; a mark still uncovered then is cleared rather than left 等发布 forever.
			miss := strconv.Itoa(it.ID) + "|" + it.ReleaseHold.At
			if releaseHoldMisses[miss] == 0 {
				releaseHoldMisses[miss] = 1
				slog.Warn("release hold: not resumed yet, no open handoff for it", "board", it.ID)
				e.notifyReleaseHoldUnresumed(chat, it)
				left++
				continue
			}
			delete(releaseHoldMisses, miss)
			if err := releaseHoldUnhold(e, chat, it.ID, it.ReleaseHold.At); err != nil {
				slog.Warn("release hold: unhold failed", "board", it.ID, "error", err)
				left++
				continue
			}
			slog.Warn("release hold: cleared, no open handoff left for it", "board", it.ID)
			continue
		}
		delete(releaseHoldMisses, strconv.Itoa(it.ID)+"|"+it.ReleaseHold.At)
		if e.watchBusy(a.key) {
			left++ // the workspace is running a turn (an interrupted one resumed): try again later
			continue
		}
		// A fresh start for the resumed item: errors and wakes during the release do not count.
		// Reset and wake before unmarking: if the wake does not go out, the mark stays and the
		// next pass tries again (#984 review: unmarking first lost both).
		h, saved := e.updateIdle(a, func(h *TeamHandoff) {
			h.Idle.Fails, h.Idle.Wakes, h.Idle.Reported, h.Idle.Returned = 0, 0, false, false
			h.Idle.Ended = time.Now()
		})
		if !saved {
			left++
			continue
		}
		a.h = h
		if !e.sendIdleWake(a, h) {
			left++
			continue
		}
		slog.Info("release hold: resuming", "board", it.ID, "workspace", a.key)
		if err := releaseHoldUnhold(e, chat, it.ID, it.ReleaseHold.At); err != nil {
			// Woken already; the stale mark no longer holds the watch (activeReleaseHold), so the
			// item is watched normally. Only the board row keeps showing it until cleared.
			slog.Warn("release hold: unhold failed after resume", "board", it.ID, "error", err)
		}
	}
	return left
}

// notifyReleaseHoldUnresumed tells the item's chat channel that a held item had nobody to resume it.
func (e *Engine) notifyReleaseHoldUnresumed(chat string, it teamTaskBoardItem) {
	plat, _, _ := strings.Cut(chat, ":")
	p := e.lookupReadyPlatform(plat)
	if p == nil {
		return
	}
	if err := newHandoffWatch(e).send(p, chat, e.i18n.Tf(MsgReleaseHoldUnresumed, it.ID, teamTaskBoardShort(it))); err != nil {
		slog.Warn("release hold: notice failed", "board", it.ID, "error", err)
	}
}

// releaseHoldCovered: some open handoff or script watch, of any engine, works on board item id.
func (e *Engine) releaseHoldCovered(id int) bool {
	items := readTeamTaskBoard(e.team.dir)
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
	for _, all := range []map[string][]TeamHandoff{st.Handoffs, st.ScriptWatches} {
		for key, rows := range all {
			for _, h := range rows {
				if teamHandoffOpen(h) && handoffBoardID(key, h, items) == id {
					return true
				}
			}
		}
	}
	return false
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
	items := readTeamTaskBoard(e.team.dir)
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
				if handoffBoardID(key, h, items) == id && teamHandoffOpen(h) && e.watchOwns(p, h.Owner) {
					return idleAssignment{key, h, script}, true
				}
			}
		}
	}
	return idleAssignment{}, false
}
