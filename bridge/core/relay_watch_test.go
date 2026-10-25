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
	if n := p.relayWatchTick(now.Add(time.Minute)); !n.Equal(now.Add(watchCheckAfter())) || relayWatchStopped(d) != 0 {
		t.Fatalf("before due: next=%v cancels=%d", n, relayWatchStopped(d))
	}
	p.relayWatchTick(now.Add(watchCheckAfter()))
	if relayWatchStopped(d) != 1 || !relayWatchReceipt(d).WatchDone {
		t.Fatalf("not stopped: cancels=%d", relayWatchStopped(d))
	}
	if !strings.Contains(relayWatchLastEvent(d), "十分钟看门") {
		t.Fatalf("no nudge in thread: %q", relayWatchLastEvent(d))
	}
	if err := d.finish("partial text", errRelayWatchStopped); err != nil {
		t.Fatal(err)
	}
	rc := relayWatchReceipt(d)
	if rc.Status != "failed" || rc.Response != "partial text" || !strings.Contains(rc.Error, "十分钟看门停止") {
		t.Fatalf("receipt %+v", rc)
	}
	p.relayWatchTick(now.Add(time.Hour)) // handed back: skipped
	if relayWatchStopped(d) != 1 {
		t.Fatal("watched a finished receipt again")
	}
}

func TestRelayWatchProgressRenewsThenStopsAfterTwo(t *testing.T) {
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
			if relayWatchStopped(d) != 1 || !relayWatchReceipt(d).WatchDone || !strings.Contains(relayWatchLastEvent(d), "十分钟看门") {
				t.Fatalf("not nudged: cancels=%d event=%q", relayWatchStopped(d), relayWatchLastEvent(d))
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

// A cancelled lead turn ends the card: the watch stops with it (unchanged).
func TestRelayWatchStopsOnCancelledTurn(t *testing.T) {
	p, _, run, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	p.finish(run, "cancelled")
	if n := p.relayWatchTick(time.Now().Add(time.Hour)); !n.IsZero() || relayWatchStopped(d) != 0 {
		t.Fatalf("cancelled card still watched: next=%v", n)
	}
}
