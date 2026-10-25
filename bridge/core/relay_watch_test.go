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
