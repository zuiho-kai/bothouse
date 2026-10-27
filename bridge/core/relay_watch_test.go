package core

import (
	"strings"
	"testing"
	"time"
)

// relayWatchStopped: the watch closed the run's stop channel (counted as 1 stop).
func relayWatchStopped(d *taskRelay) int {
	select {
	case <-d.stop:
		return 1
	default:
		return 0
	}
}

// now is the start of the receipt's first window (its due time minus the check time).
func relayWatchFixture(t *testing.T) (*PublicProgress, *taskRelay, *time.Time) {
	t.Helper()
	p, _, _, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	now := relayWatchReceipt(d).WatchDue.Add(-watchCheckAfter())
	return p, d, &now
}

func relayWatchReceipt(d *taskRelay) taskRelayRecord {
	d.r.mu.Lock()
	defer d.r.mu.Unlock()
	return d.r.record.Relays[d.req.RequestID]
}

func relayWatchLastEvent(d *taskRelay) string {
	d.r.mu.Lock()
	defer d.r.mu.Unlock()
	ev := d.r.record.Task.Events
	return ev[len(ev)-1].Summary
}

func relayWatchReport(t *testing.T, p *PublicProgress, d *taskRelay, seq int64) {
	t.Helper()
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	if _, err := p.reportTaskRelay(d, PublicProgressRequest{Project: "source", SessionKey: d.req.SessionKey, Run: d.token, Seq: seq, Kind: "update", Summary: "step"}); err != nil {
		t.Fatal(err)
	}
}

func TestRelayWatchNoProgressNudgesAndStops(t *testing.T) {
	p, d, now := relayWatchFixture(t)
	due := now.Add(watchCheckAfter())
	if n := p.relayWatchTick(now.Add(time.Minute)); !n.Equal(due) || relayWatchStopped(d) != 0 {
		t.Fatalf("before due: next=%v cancels=%d", n, relayWatchStopped(d))
	}
	p.relayWatchTick(due)
	rc := relayWatchReceipt(d)
	if relayWatchStopped(d) != 0 || rc.WatchDone || !rc.WatchNudged {
		t.Fatalf("first quiet check did not grant a reminder window: cancels=%d rc=%+v", relayWatchStopped(d), rc)
	}
	select {
	case msg := <-d.nudge:
		if !strings.Contains(msg, "回报") || !strings.Contains(msg, "卡") {
			t.Fatalf("reminder does not ask for progress or a blocker: %q", msg)
		}
	default:
		t.Fatal("first quiet check did not queue a reminder")
	}
	if !rc.WatchDue.Equal(due.Add(watchCheckAfter())) {
		t.Fatalf("reminder window due %v, want %v", rc.WatchDue, due.Add(watchCheckAfter()))
	}
	if !strings.Contains(relayWatchLastEvent(d), "十分钟看门提醒") {
		t.Fatalf("no nudge in thread: %q", relayWatchLastEvent(d))
	}
	second := rc.WatchDue
	p.relayWatchTick(second)
	if relayWatchStopped(d) != 1 || !relayWatchReceipt(d).WatchDone {
		t.Fatalf("second quiet check did not stop: cancels=%d rc=%+v", relayWatchStopped(d), relayWatchReceipt(d))
	}
	if !strings.Contains(relayWatchLastEvent(d), "提醒过") {
		t.Fatalf("stop note does not mention the reminder: %q", relayWatchLastEvent(d))
	}
	if err := d.finish("partial text", errRelayWatchStopped); err != nil {
		t.Fatal(err)
	}
	rc = relayWatchReceipt(d)
	if rc.Status != "failed" || rc.Response != "partial text" || !strings.Contains(rc.Error, "十分钟看门停止") {
		t.Fatalf("receipt %+v", rc)
	}
	p.relayWatchTick(second.Add(time.Hour)) // handed back: skipped
	if relayWatchStopped(d) != 1 {
		t.Fatal("watched a finished receipt again")
	}
}

// A progress renewal re-arms the reminder: a still quiet window after it gets
// another reminder instead of an immediate stop. Regression for #496 review.
func TestRelayWatchProgressAfterReminderNudgesAgainThenStops(t *testing.T) {
	p, d, now := relayWatchFixture(t)
	due := now.Add(watchCheckAfter())
	p.relayWatchTick(due)
	rc := relayWatchReceipt(d)
	if !rc.WatchNudged {
		t.Fatal("no reminder at the first quiet check")
	}
	select {
	case <-d.nudge:
	default:
		t.Fatal("no reminder queued")
	}
	reminderDue := rc.WatchDue
	relayWatchReport(t, p, d, 1)
	next := p.relayWatchTick(reminderDue)
	rc = relayWatchReceipt(d)
	if relayWatchStopped(d) != 0 || rc.WatchRenewed != 1 || rc.WatchNudged || !next.Equal(reminderDue.Add(watchCheckAfter())) {
		t.Fatalf("progress in the reminder window did not renew and re-arm: cancels=%d rc=%+v next=%v", relayWatchStopped(d), rc, next)
	}
	// The first quiet check of the renewed window must remind again, not stop.
	p.relayWatchTick(next)
	rc = relayWatchReceipt(d)
	if relayWatchStopped(d) != 0 || rc.WatchDone || !rc.WatchNudged {
		t.Fatalf("quiet window after progress did not get another reminder: cancels=%d rc=%+v", relayWatchStopped(d), rc)
	}
	select {
	case extra := <-d.nudge:
		if !strings.Contains(extra, "回报") {
			t.Fatalf("second reminder does not ask for progress: %q", extra)
		}
	default:
		t.Fatal("quiet window after progress did not queue a second reminder")
	}
	if !strings.Contains(relayWatchLastEvent(d), "十分钟看门提醒") {
		t.Fatalf("no second nudge in thread: %q", relayWatchLastEvent(d))
	}
	// Only the next quiet window after that reminder stops the run.
	p.relayWatchTick(rc.WatchDue)
	if relayWatchStopped(d) != 1 || !relayWatchReceipt(d).WatchDone {
		t.Fatalf("second reminder window did not stop: cancels=%d rc=%+v", relayWatchStopped(d), relayWatchReceipt(d))
	}
}

func TestRelayWatchProgressRenewsThenStopsAfterTwo(t *testing.T) {
	withWatchMaxRenew(t, 2)
	p, d, now := relayWatchFixture(t)
	at := *now
	for i := 1; i <= watchMaxRenew; i++ {
		relayWatchReport(t, p, d, int64(i))
		at = relayWatchReceipt(d).WatchDue
		next := p.relayWatchTick(at)
		if relayWatchStopped(d) != 0 || relayWatchReceipt(d).WatchRenewed != i || !next.Equal(at.Add(watchCheckAfter())) {
			t.Fatalf("renew %d: cancels=%d rc=%+v next=%v", i, relayWatchStopped(d), relayWatchReceipt(d), next)
		}
	}
	relayWatchReport(t, p, d, int64(watchMaxRenew+1)) // progress, but renewals used up
	p.relayWatchTick(relayWatchReceipt(d).WatchDue)
	if relayWatchStopped(d) != 1 || !relayWatchReceipt(d).WatchDone {
		t.Fatalf("not stopped after %d renewals: cancels=%d", watchMaxRenew, relayWatchStopped(d))
	}
}

func TestRelayWatchRestartReportsInterruptedOnce(t *testing.T) {
	p, d, now := relayWatchFixture(t)
	p.mu.Lock()
	delete(p.relayRuns, d.token) // the in-memory run is gone after a restart
	p.mu.Unlock()
	due := now.Add(watchCheckAfter())
	p.relayWatchTick(due)
	if !strings.Contains(relayWatchLastEvent(d), "请重派") || relayWatchStopped(d) != 0 {
		t.Fatalf("event %q cancels=%d", relayWatchLastEvent(d), relayWatchStopped(d))
	}
	d.r.mu.Lock()
	n := len(d.r.record.Task.Events)
	d.r.mu.Unlock()
	p.relayWatchTick(due.Add(time.Hour))
	d.r.mu.Lock()
	m := len(d.r.record.Task.Events)
	d.r.mu.Unlock()
	if m != n {
		t.Fatal("interrupted reported more than once")
	}
}

// #597 G28: a relay sent in the background outlives the lead's turn. finishRun
// closes the card when the turn ends; the watch must keep checking the running
// receipt (renew on progress, nudge and stop without), then stop once handed back.
func TestRelayWatchSurvivesLeadTurnEnd(t *testing.T) {
	for _, tc := range []struct {
		name string
		end  func(p *PublicProgress, run string, d *taskRelay)
	}{
		{"own card", func(p *PublicProgress, run string, _ *taskRelay) { p.finish(run, "result") }},
		{"delegated card", func(p *PublicProgress, _ string, d *taskRelay) {
			p.transitionMu.Lock()
			defer p.transitionMu.Unlock()
			p.finishRun(d.r, "result", true)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, _, run, id := taskRelayFixture(t)
			d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
			if err != nil {
				t.Fatal(err)
			}
			now := relayWatchReceipt(d).WatchDue.Add(-watchCheckAfter())
			tc.end(p, run, d)
			d.r.mu.Lock()
			closed := d.r.record.Closed
			d.r.mu.Unlock()
			if !closed {
				t.Fatal("turn end did not close the card")
			}
			due := now.Add(watchCheckAfter())
			if n := p.relayWatchTick(now.Add(time.Minute)); !n.Equal(due) {
				t.Fatalf("watch dropped after turn end: next=%v want %v", n, due)
			}
			relayWatchReport(t, p, d, 1) // the worker can still report progress
			next := p.relayWatchTick(due)
			if relayWatchStopped(d) != 0 || relayWatchReceipt(d).WatchRenewed != 1 || !next.Equal(due.Add(watchCheckAfter())) {
				t.Fatalf("not renewed: cancels=%d rc=%+v next=%v", relayWatchStopped(d), relayWatchReceipt(d), next)
			}
			p.relayWatchTick(next) // no progress in the second window
			if relayWatchStopped(d) != 0 || relayWatchReceipt(d).WatchDone || !relayWatchReceipt(d).WatchNudged {
				t.Fatalf("not nudged: cancels=%d event=%q", relayWatchStopped(d), relayWatchLastEvent(d))
			}
			p.relayWatchTick(relayWatchReceipt(d).WatchDue) // the reminder window is also quiet
			if relayWatchStopped(d) != 1 || !relayWatchReceipt(d).WatchDone || !strings.Contains(relayWatchLastEvent(d), "提醒过") {
				t.Fatalf("not stopped after the reminder: cancels=%d event=%q", relayWatchStopped(d), relayWatchLastEvent(d))
			}
			if err := d.finish("partial", errRelayWatchStopped); err != nil {
				t.Fatal(err)
			}
			if n := p.relayWatchTick(next.Add(time.Hour)); !n.IsZero() || relayWatchStopped(d) != 1 {
				t.Fatalf("watched a handed-back receipt: next=%v", n)
			}
		})
	}
}

// Handed back after the turn ended: nothing left to watch, the loop may exit.
func TestRelayWatchStopsWhenDoneAfterTurnEnd(t *testing.T) {
	p, _, run, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	if err := d.finish("result text", nil); err != nil {
		t.Fatal(err)
	}
	if relayWatchReceipt(d).Status != "done" {
		t.Fatalf("receipt %+v", relayWatchReceipt(d))
	}
	if n := p.relayWatchTick(time.Now().Add(time.Hour)); !n.IsZero() || relayWatchStopped(d) != 0 {
		t.Fatalf("done receipt still watched: next=%v", n)
	}
}

// The card ends (failed: the lead's reply was not sent; cancelled: /stop or
// maxTurnTime; or accepted) while a relay still runs: the watch stays its one
// keeper with the same rule (renew on progress, nudge and stop without); the
// card's state and summary are left as they were.
func TestRelayWatchKeepsRunningRelayOnEndedCard(t *testing.T) {
	for _, tc := range []struct {
		name string
		end  func(p *PublicProgress, run string, d *taskRelay)
	}{
		{"cancelled", func(p *PublicProgress, run string, _ *taskRelay) { p.finish(run, "cancelled") }},
		{"failed", func(p *PublicProgress, run string, _ *taskRelay) { p.finish(run, "failed") }},
		{"accepted", func(_ *PublicProgress, _ string, d *taskRelay) {
			d.r.mu.Lock()
			d.r.record.Accepted = true
			d.r.mu.Unlock()
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, _, run, id := taskRelayFixture(t)
			d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
			if err != nil {
				t.Fatal(err)
			}
			due := relayWatchReceipt(d).WatchDue
			tc.end(p, run, d)
			before, _ := p.Task(id)
			if n := p.relayWatchTick(due.Add(-time.Minute)); !n.Equal(due) {
				t.Fatalf("running relay unwatched on ended card: next=%v want %v", n, due)
			}
			relayWatchReport(t, p, d, 1) // the worker can still report on an ended card
			next := p.relayWatchTick(due)
			if relayWatchStopped(d) != 0 || relayWatchReceipt(d).WatchRenewed != 1 || !next.Equal(due.Add(watchCheckAfter())) {
				t.Fatalf("not renewed on progress: cancels=%d rc=%+v next=%v", relayWatchStopped(d), relayWatchReceipt(d), next)
			}
			p.relayWatchTick(next) // no progress in the second window
			if relayWatchStopped(d) != 0 || relayWatchReceipt(d).WatchDone || !relayWatchReceipt(d).WatchNudged {
				t.Fatalf("not nudged: cancels=%d event=%q", relayWatchStopped(d), relayWatchLastEvent(d))
			}
			p.relayWatchTick(relayWatchReceipt(d).WatchDue) // the reminder window is also quiet
			if relayWatchStopped(d) != 1 || !relayWatchReceipt(d).WatchDone || !strings.Contains(relayWatchLastEvent(d), "提醒过") {
				t.Fatalf("not stopped after the reminder: cancels=%d event=%q", relayWatchStopped(d), relayWatchLastEvent(d))
			}
			after, _ := p.Task(id)
			if after.State != before.State || after.LatestProgress != before.LatestProgress {
				t.Fatalf("relay moved the ended card: %v/%q -> %v/%q", before.State, before.LatestProgress, after.State, after.LatestProgress)
			}
			if err := d.finish("partial", errRelayWatchStopped); err != nil {
				t.Fatal(err)
			}
			if n := p.relayWatchTick(next.Add(time.Hour)); !n.IsZero() || relayWatchStopped(d) != 1 {
				t.Fatalf("watched a handed-back receipt: next=%v", n)
			}
		})
	}
}

// After the turn closed the card, relay progress lands in the thread but does
// not move the card's summary (same rule as the relay's final result).
func TestRelayProgressKeepsClosedCardSummary(t *testing.T) {
	p, _, run, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	before, _ := p.Task(id)
	relayWatchReport(t, p, d, 1)
	after, _ := p.Task(id)
	if after.LatestProgress != before.LatestProgress {
		t.Fatalf("closed card summary moved: %q -> %q", before.LatestProgress, after.LatestProgress)
	}
	if len(after.Events) != len(before.Events)+1 || after.Events[len(after.Events)-1].Detail != "step" {
		t.Fatalf("progress not in thread: %+v", after.Events[len(after.Events)-1])
	}
}

// #597 G30: a receipt still running when the bridge restarts gets its watch at
// engine start, without a new dispatch: at due it is reported interrupted once.
func TestRelayWatchResumesAfterRestartWithoutDispatch(t *testing.T) {
	old := watchCheckAfter()
	watchCheckAfterNs.Store(int64(50 * time.Millisecond))
	t.Cleanup(func() { watchCheckAfterNs.Store(int64(old)) })
	p, platform, _, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	restored, err := NewPublicProgress(p.dataDir, "source", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	_, e, _, _, _ := inputFixture(t)
	e.publicProgress = restored
	e.startPublicProgress()
	if !restored.watchOn.Load() {
		t.Fatal("engine start did not start the watch for a running receipt")
	}
	restored.mu.Lock()
	r := restored.records[d.req.TaskID]
	restored.mu.Unlock()
	inputWait(t, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.record.Relays[d.req.RequestID].WatchDone
	})
	r.mu.Lock()
	ev := r.record.Task.Events
	last := ev[len(ev)-1].Summary
	r.mu.Unlock()
	if !strings.Contains(last, "桥重启过") {
		t.Fatalf("no interrupted note: %q", last)
	}
}

// No running receipt on disk: engine start does not start the watch loop.
func TestRelayWatchNotResumedWithoutRunningReceipt(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	if err := d.finish("done", nil); err != nil {
		t.Fatal(err)
	}
	restored, err := NewPublicProgress(p.dataDir, "source", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	_, e, _, _, _ := inputFixture(t)
	e.publicProgress = restored
	e.startPublicProgress()
	if restored.watchOn.Load() {
		t.Fatal("watch started with nothing to watch")
	}
}

// #429: by default a task relay with progress is renewed past two checks; a quiet one stops.
func TestRelayWatchRenewsWhileProgressByDefault(t *testing.T) {
	p, d, now := relayWatchFixture(t)
	at := *now
	for i := 1; i <= 5; i++ {
		relayWatchReport(t, p, d, int64(i))
		at = relayWatchReceipt(d).WatchDue
		p.relayWatchTick(at)
		if relayWatchStopped(d) != 0 || relayWatchReceipt(d).WatchRenewed != i {
			t.Fatalf("check %d with progress: cancels=%d receipt=%+v", i, relayWatchStopped(d), relayWatchReceipt(d))
		}
	}
	p.relayWatchTick(relayWatchReceipt(d).WatchDue)
	if relayWatchStopped(d) != 0 || relayWatchReceipt(d).WatchDone || !relayWatchReceipt(d).WatchNudged {
		t.Fatalf("quiet window not reminded: cancels=%d receipt=%+v", relayWatchStopped(d), relayWatchReceipt(d))
	}
	p.relayWatchTick(relayWatchReceipt(d).WatchDue)
	if relayWatchStopped(d) != 1 || !relayWatchReceipt(d).WatchDone {
		t.Fatalf("quiet window not stopped: cancels=%d receipt=%+v", relayWatchStopped(d), relayWatchReceipt(d))
	}
}
