package core

import (
	"context"
	"slices"
	"time"
)

// #1020: a platform that implements QueueReporter is told which user messages
// wait in each session's queue (interactiveState.pendingMessages), so a chat UI
// can show 「排队 N 条」 and let the owner withdraw one (a recall already removes a
// queued message: removeQueuedMessageByID). The queue is changed in many places
// (enqueue, drain, batch, stale drop, recall, handoff); polling one snapshot a
// second reports every change without touching them.
const queueReportEvery = time.Second

type queueReport struct {
	platform Platform
	replyCtx any
	ids      []string
}

func (e *Engine) queueReportLoop() {
	t := time.NewTicker(queueReportEvery)
	defer t.Stop()
	last := map[string]queueReport{}
	for {
		select {
		case <-e.ctx.Done():
			return
		case <-t.C:
			last = e.reportQueues(last)
		}
	}
}

// reportQueues sends the queues that changed since last and returns the new snapshot.
func (e *Engine) reportQueues(last map[string]queueReport) map[string]queueReport {
	e.interactiveMu.Lock()
	states := make(map[string]*interactiveState, len(e.interactiveStates))
	for k, s := range e.interactiveStates {
		states[k] = s
	}
	e.interactiveMu.Unlock()
	now := make(map[string]queueReport, len(last))
	for key, state := range states {
		if state == nil {
			continue
		}
		state.mu.Lock()
		r := queueReport{platform: state.platform, replyCtx: state.replyCtx}
		for _, q := range state.pendingMessages {
			if q.messageID == "" {
				continue
			}
			if r.platform == nil {
				r.platform, r.replyCtx = q.platform, q.replyCtx
			}
			r.ids = append(r.ids, q.messageID)
		}
		state.mu.Unlock()
		if _, ok := r.platform.(QueueReporter); !ok {
			continue
		}
		if len(r.ids) > 0 {
			now[key] = r
		}
		if prev, ok := last[key]; ok && slices.Equal(prev.ids, r.ids) || !ok && len(r.ids) == 0 {
			continue
		}
		e.sendQueueReport(r)
	}
	// A state that went away (or emptied above) with a queue last time: clear it.
	for key, prev := range last {
		if _, ok := states[key]; !ok {
			e.sendQueueReport(queueReport{platform: prev.platform, replyCtx: prev.replyCtx})
		}
	}
	return now
}

func (e *Engine) sendQueueReport(r queueReport) {
	qr, ok := r.platform.(QueueReporter)
	if !ok || r.replyCtx == nil {
		return
	}
	ctx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
	defer cancel()
	_ = qr.ReportQueue(ctx, r.replyCtx, r.ids)
}
