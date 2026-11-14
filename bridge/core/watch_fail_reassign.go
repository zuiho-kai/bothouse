package core

import (
	"log/slog"
	"strings"
	"time"
)

// Reassign after repeated errors (user 2026-11-04 「可以」 to: 看门停后自动把活改派给空闲且未冷却的
// 队友，从停点续，不等主角色). When a watched assignment ends watchFailLimit turns in a row with an
// agent error (on 11-04 a relay's 429s), the watch hands the work to a teammate bound to the same
// channel who is not busy, paused or cooling down — the same pick and the same owner transfer as the
// quota takeover (quota_takeover.go) — and tells the channel who took it. Only when nobody is free
// does it fall back to asking the primary role (escalateIdle).

// reassignFailedWork moves the failing assignment a (handoff h in workspace key) to a free teammate
// and wakes them there. false: nobody free, or the transfer failed; the caller escalates.
func (e *Engine) reassignFailedWork(a idleAssignment, h TeamHandoff) bool {
	work, ok := e.failedWork(a, h)
	if !ok {
		return false
	}
	target := e.quotaCandidate(work.Session, nil)
	if target == nil {
		return false
	}
	now := time.Now()
	if err := e.applyQuotaWork(work, target, now); err != nil {
		slog.Warn("watch reassign: owner transfer failed", "work", work.ID, "to", target.name, "error", err)
		return false
	}
	prompt := target.i18n.Tf(MsgWatchFailPrompt, e.DisplayName(), work.Title, work.Basis)
	if err := e.queueQuotaWake(target, "watchfail:"+work.ID, work.Session, prompt, work.Title); err != nil {
		// The owner already moved: the target's own watch picks the handoff up; say so anyway.
		slog.Warn("watch reassign: wake failed", "work", work.ID, "to", target.name, "error", err)
	}
	plat, _, _ := strings.Cut(a.key, ":")
	sender := e.watchSender(h)
	if p := sender.lookupReadyPlatform(plat); p != nil {
		text := sender.i18n.Tf(MsgWatchFailReassigned, e.DisplayName(), h.Title, target.DisplayName())
		if err := newHandoffWatch(sender).send(p, h.Chat, text); err != nil {
			slog.Warn("watch reassign: notice failed", "error", err)
		}
	}
	slog.Info("watch reassign: failing work handed over", "from", e.name, "to", target.name, "work", work.ID)
	return true
}

// failedWork: the quota-takeover record of a's work (its board item, else its handoff).
func (e *Engine) failedWork(a idleAssignment, h TeamHandoff) (quotaWork, bool) {
	board := h.Board // #699 D: the id the claim recorded, never a number read from the title
	for _, w := range e.quotaWorkItems() {
		if w.Task != "" {
			continue // a public task's owner moves with its handoff, not on its own
		}
		if board != 0 && w.Board == board || w.Board == 0 && w.Session == a.key && w.At.Equal(h.At) {
			if w.Board != 0 {
				w.Session = a.key // the board item's work runs in this workspace
				w.At = h.At
			}
			return w, true
		}
	}
	return quotaWork{}, false
}
