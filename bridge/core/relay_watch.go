package core

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

// Ten-minute watch for work sent with task assign + relay --task. The record is
// the task receipt (taskRelayRecord.Watch*), not a workspace handoff, so
// `workspace list` watch_due never includes it. Progress = the receipt was
// handed back (status not running), LastSeq grew, or the worker's own member
// row on the card was updated since the window began; a busy session is not
// progress (a relay turn is busy until it returns). Cadence and renew limit are
// team_watch's (watchCheckAfter, watchMaxRenew). A stop closes the worker's
// session at once (handleTrackedRelay's stop channel), not the relay drain.
// The gate is the receipt alone (running, not yet nudged, run still known),
// never the card: a relay sent in the background keeps running after the lead's
// turn closes the card (finishRun), and after the card turns failed/cancelled
// or accepted, so the watch stays its one keeper until it is handed back or
// stopped. On a card the lead no longer holds (taskRelayActive false) the
// watch's notes go to the thread without moving the card's summary.

// errRelayWatchStopped marks a run the watch stopped, like d10 stopping a turn.
var errRelayWatchStopped = errors.New("十分钟看门停止：到点没有交回结果，会话已关，做到的部分作为部分结果交回")

const (
	relayWatchNudge       = "十分钟看门：到点还没交回结果。这一轮已停下，做到的部分作为部分结果交回；请看结果再决定是否重派。"
	relayWatchInterrupted = "十分钟看门：这次派活的执行已中断（桥重启过），请重派。"
)

// stopWatch closes the run's stop channel once; handleTrackedRelay closes the session.
func (d *taskRelay) stopWatch() { d.stopOnce.Do(func() { close(d.stop) }) }

// ensureRelayWatch runs the receipt watch loop for p unless it is running. It
// is started by every task dispatch and at engine start (resumeRelayWatch), so
// the watch needs no API server, team lead or workspace watch. The loop ends when nothing is left to watch.
func (p *PublicProgress) ensureRelayWatch(ctx context.Context) {
	if ctx == nil || ctx.Err() != nil {
		slog.Error("relay watch: not started, engine is stopping; this dispatch has no ten-minute watch", "project", p.project)
		return
	}
	if !p.watchOn.CompareAndSwap(false, true) {
		return
	}
	go p.runRelayWatch(ctx)
}

// resumeRelayWatch starts the watch loop at engine start when receipts read
// back from disk still wait for it (running, due set, not done). The runs are
// gone after a restart, so at due the loop reports them interrupted once
// (relayWatchRun, d == nil). Without this, a dispatch sent before a restart had
// no watch until the next dispatch started the loop.
func (p *PublicProgress) resumeRelayWatch(ctx context.Context) {
	if p.relayWatchWaiting() {
		p.ensureRelayWatch(ctx)
	}
}

// relayWatchWaiting: some receipt is running with a watch not yet done.
func (p *PublicProgress) relayWatchWaiting() bool {
	p.mu.Lock()
	runs := make([]*publicRun, 0, len(p.records))
	for _, r := range p.records {
		runs = append(runs, r)
	}
	p.mu.Unlock()
	for _, r := range runs {
		r.mu.Lock()
		for _, rc := range r.record.Relays {
			if rc.Status == "running" && !rc.WatchDue.IsZero() && !rc.WatchDone {
				r.mu.Unlock()
				return true
			}
		}
		r.mu.Unlock()
	}
	return false
}

func (p *PublicProgress) runRelayWatch(ctx context.Context) {
	for {
		next := p.relayWatchTick(time.Now())
		if next.IsZero() {
			// Hand the loop back, then look once more: a dispatch that saw the
			// loop still on just before this added a receipt nobody would watch.
			p.watchOn.Store(false)
			if p.relayWatchTick(time.Now()).IsZero() || !p.watchOn.CompareAndSwap(false, true) {
				return
			}
			continue
		}
		wait := time.Until(next)
		if idle := watchIdleWake(); wait > idle {
			wait = idle
		}
		if wait <= 0 {
			wait = time.Millisecond
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			p.watchOn.Store(false)
			return
		case <-t.C:
		}
	}
}

// relayMemberProgress: the worker updated its own row on the card since `since`.
func relayMemberProgress(t *Task, project string, since time.Time) bool {
	for _, m := range t.Members {
		if m.ReporterProject == project && !m.StartedAt.IsZero() && m.UpdatedAt.After(since) {
			return true
		}
	}
	return false
}

// relayWatchTick checks every running receipt whose watch is due and returns
// the next due time (zero if none).
func (p *PublicProgress) relayWatchTick(now time.Time) time.Time {
	if p == nil {
		return time.Time{}
	}
	p.mu.Lock()
	runs := make([]*publicRun, 0, len(p.records))
	for _, r := range p.records {
		runs = append(runs, r)
	}
	live := make(map[string]*taskRelay, len(p.relayRuns))
	for _, d := range p.relayRuns {
		live[d.req.TaskID+"\x00"+d.req.RequestID] = d
	}
	p.mu.Unlock()
	var next time.Time
	for _, r := range runs {
		if n := p.relayWatchRun(r, live, now); !n.IsZero() && (next.IsZero() || n.Before(next)) {
			next = n
		}
	}
	return next
}

func (p *PublicProgress) relayWatchRun(r *publicRun, live map[string]*taskRelay, now time.Time) time.Time {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	var next time.Time
	var stop []*taskRelay
	changed := false
	old := snapshotTaskRelay(r)
	summary := r.record.Task.LatestProgress
	for id, rc := range r.record.Relays {
		if rc.Status != "running" || rc.WatchDue.IsZero() || rc.WatchDone {
			continue
		}
		if now.Before(rc.WatchDue) {
			if next.IsZero() || rc.WatchDue.Before(next) {
				next = rc.WatchDue
			}
			continue
		}
		d := live[r.record.Task.ID+"\x00"+id]
		changed = true
		switch {
		case d == nil: // restart: the run is gone; report once, no nudge, no retry
			rc.WatchDone = true
			p.appendEvent(r, TaskEventProgress, relayWatchInterrupted, true)
		case (rc.LastSeq > rc.WatchSeq || relayMemberProgress(r.record.Task, rc.Target, rc.WatchFrom)) && rc.WatchRenewed < watchMaxRenew:
			rc.WatchRenewed++
			rc.WatchSeq = rc.LastSeq
			rc.WatchFrom = now
			rc.WatchDue = now.Add(watchCheckAfter())
			if next.IsZero() || rc.WatchDue.Before(next) {
				next = rc.WatchDue
			}
		default: // no progress, or renewed twice already: nudge in the thread, tell the card, stop
			rc.WatchDone = true
			p.appendEvent(r, TaskEventProgress, relayWatchNudge+"（"+d.name+"）", true)
			stop = append(stop, d)
		}
		r.record.Relays[id] = rc
	}
	if !changed {
		return next
	}
	if !taskRelayActive(r) {
		r.record.Task.LatestProgress = summary
	}
	if err := p.save(r); err != nil {
		r.record = old
		slog.Error("relay watch: save failed", "task_id", r.record.Task.ID, "error", err)
		return now.Add(watchRetryDelay)
	}
	p.queueTaskRelay(r)
	for _, d := range stop {
		d.stopWatch()
	}
	return next
}
