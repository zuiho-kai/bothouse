package core

import (
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// A workspace member that answers "can't do" twice in a row, or whose model refuses the work,
// hands the work to another member (lead or teammate) instead of pausing it for a person
// (user 11-06 02:1x「我明天起床，我要看到他那边完成这几个最基本，最简单的需求啊」: agentm #5 was
// paused at 17:13Z after 龙娘's model refused twice, and nothing moved all night). Only when no
// other member can take it does the board item pause and a person get told (pauseCantDo).
// Who refused is kept in the #1109 refusal record (team-review-refused.json) under
// cantDoRefusedKey, so neither this watch nor ws-handoff's pick_worker gives it back to her.

// cantDoRefusedKey: the refusal-record key of board item board's work turns.
func cantDoRefusedKey(board int) string {
	return fmt.Sprintf("work/%d", board)
}

func recordCantDo(dir string, board int, project string) {
	if dir == "" || board == 0 || project == "" {
		return
	}
	appendRefused(dir, cantDoRefusedKey(board), project)
}

// cantDoRefusers: the members that refused board's work (nil when none / no board).
func cantDoRefusers(dir string, board int) map[string]bool {
	if dir == "" || board == 0 {
		return nil
	}
	list := readReviewRefused(dir)[cantDoRefusedKey(board)]
	if len(list) == 0 {
		return nil
	}
	out := make(map[string]bool, len(list))
	for _, p := range list {
		out[p] = true
	}
	return out
}

// reassignCantDo moves a's work to another member that has not refused it and wakes her; false:
// nobody to take it (the caller pauses and tells a person).
func (e *Engine) reassignCantDo(a idleAssignment, h TeamHandoff) bool {
	work, ok := e.failedWork(a, h)
	if !ok {
		return false
	}
	dir := ""
	if e.team != nil {
		dir = e.team.dir
	}
	recordCantDo(dir, work.Board, e.name)
	reserved := cantDoRefusers(dir, work.Board)
	target := e.quotaCandidate(work.Session, work.Title+" "+work.Basis, reserved)
	if target == nil {
		slog.Warn("watch reassign: cant-do, no other member free", "from", e.name, "work", work.ID)
		return false
	}
	if err := e.applyQuotaWork(work, target, time.Now()); err != nil {
		slog.Warn("watch reassign: cant-do owner transfer failed", "work", work.ID, "to", target.name, "error", err)
		return false
	}
	prompt := target.i18n.Tf(MsgWatchCantDoPrompt, e.DisplayName(), work.Title, work.Basis)
	if err := e.queueQuotaWake(target, "cantdo:"+work.ID, work.Session, prompt, work.Title); err != nil {
		slog.Warn("watch reassign: cant-do wake failed", "work", work.ID, "to", target.name, "error", err)
	}
	plat, _, _ := strings.Cut(a.key, ":")
	sender := e.watchSender(h)
	if p := sender.lookupReadyPlatform(plat); p != nil {
		text := sender.i18n.Tf(MsgWatchCantDoReassigned, e.DisplayName(), h.Title, target.DisplayName())
		if err := newHandoffWatch(sender).send(p, h.Chat, text); err != nil {
			slog.Warn("watch reassign: cant-do notice failed", "error", err)
		}
	}
	slog.Info("watch reassign: cant-do work handed over", "from", e.name, "to", target.name, "work", work.ID)
	return true
}
