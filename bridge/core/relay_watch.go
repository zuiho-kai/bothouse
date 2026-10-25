package core

import (
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// Ten-minute watch for work sent with task assign + relay --task. The record is
// the task receipt (taskRelayRecord.Watch*), not a workspace handoff, so
// `workspace list` watch_due never includes it. Progress = the receipt was
// handed back (status not running) or LastSeq grew since the last check; a busy
// session is not progress (a relay turn is busy until it returns). Cadence and
// renew limit are team_watch's (watchCheckAfter, watchMaxRenew). The existing
// relay timeout + drain (~30 minutes) stays the only hard stop.

// relayWatchNow is the watch clock; tests replace it.
var relayWatchNow = time.Now

// errRelayWatchStopped marks a run the watch stopped, like d10 stopping a turn.
var errRelayWatchStopped = errors.New("十分钟看门停止：到点没有进展，已停下，做到的部分已交回")

func (d *taskRelay) watchErr(runErr error) error {
	if d.watchStop.Load() {
		if runErr == nil {
			return errRelayWatchStopped
		}
		return fmt.Errorf("%w (%v)", errRelayWatchStopped, runErr)
	}
	return runErr
}

const (
	relayWatchNudge       = "十分钟看门：到点还没进展。请交回结果，或说明卡在哪；这一轮先停下，做到的部分交回。"
	relayWatchInterrupted = "十分钟看门：这次派活的执行已中断（桥重启过），请重派。"
)

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
		live[d.r.record.Task.ID+"\x00"+d.req.RequestID] = d
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
	active := taskRelayActive(r)
	for id, rc := range r.record.Relays {
		if rc.Status != "running" || rc.WatchDue.IsZero() || rc.WatchDone || !active {
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
		case rc.LastSeq > rc.WatchSeq && rc.WatchRenewed < watchMaxRenew:
			rc.WatchRenewed++
			rc.WatchSeq = rc.LastSeq
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
	if err := p.save(r); err != nil {
		r.record = old
		slog.Error("relay watch: save failed", "task_id", r.record.Task.ID, "error", err)
		return now.Add(watchRetryDelay)
	}
	p.queueTaskRelay(r)
	for _, d := range stop {
		d.watchStop.Store(true)
		p.mu.Lock()
		cancel := d.cancel
		p.mu.Unlock()
		if cancel != nil {
			cancel()
		}
	}
	return next
}
