package core

// Regression tests for the watch gaps found after #430 merged (#448). Each behavior test
// named here failed before the matching fix and passes after it.

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// #448 P1: with the default no-overall-cap watch, a workspace session that stays busy (a
// stuck turn) must not renew forever. Two busy-only renewals are allowed, then the handoff is
// nudged and parked. A real owner post in the window still renews and resets that budget.
func TestWatchBusyAloneDoesNotRenewForever(t *testing.T) {
	if watchMaxRenew != 0 {
		t.Fatalf("default watchMaxRenew = %d, want 0 (no overall cap)", watchMaxRenew)
	}
	e, p, w, h := progressFixture(t, k5aOwner)
	s := e.sessions.GetOrCreateActive("discord:ws1:u1")
	if !s.TryLock() {
		t.Fatal("lock busy session")
	}
	defer s.Unlock()

	now := h.Due
	for i := 1; i <= 2; i++ {
		next := w.tick(now)
		got := handoffsOf(e, "discord:ws1")[0]
		if next.IsZero() || got.Renewed != i || !got.Parked.IsZero() || len(p.out) != 0 {
			t.Fatalf("busy renewal %d: renewed silently, got %+v, next %v, sent %v", i, got, next, p.out)
		}
		now = next
	}

	// A real post in the third window renews (real progress has no cap) and resets the
	// budget for busy-only renewals.
	p.post("ws1", k5aOwner, "进度：改完一半，继续跑测试", now.Add(-time.Second))
	next := w.tick(now)
	got := handoffsOf(e, "discord:ws1")[0]
	if next.IsZero() || got.Renewed != 3 || !got.Parked.IsZero() || len(p.out) != 0 {
		t.Fatalf("real progress after two busy renewals: renewed silently, got %+v, next %v, sent %v", got, next, p.out)
	}
	now = next

	// Two more busy-only renewals, then the third busy check (with no new real progress) is
	// no progress: one nudge and parked.
	for i := 4; i <= 5; i++ {
		next = w.tick(now)
		got := handoffsOf(e, "discord:ws1")[0]
		if next.IsZero() || got.Renewed != i || !got.Parked.IsZero() || len(p.out) != 0 {
			t.Fatalf("busy renewal %d after reset: renewed silently, got %+v, next %v, sent %v", i, got, next, p.out)
		}
		now = next
	}
	if next := w.tick(now); !next.IsZero() {
		t.Fatalf("busy with no new progress must stop after the budget, next %v", next)
	}
	got = handoffsOf(e, "discord:ws1")[0]
	if got.Parked.IsZero() || got.Renewed != 5 || len(p.sentTo("discord:ws1")) != 1 {
		t.Fatalf("busy budget used up: one nudge and parked, got %+v, sent %v", got, p.out)
	}
}

// #448 P2: when the source engine is already stopping, no relay watch can start. The task
// relay's drain must keep its fixed safety limit instead of waiting forever on a stop channel
// nobody will close.
func TestTaskRelayDrainKeepsSafetyLimitWithoutWatch(t *testing.T) {
	old := relayDrainSafety
	relayDrainSafety = 20 * time.Millisecond
	t.Cleanup(func() { relayDrainSafety = old })
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	sent := make(chan struct{})
	rm, s := taskRelayManager(t, p, platform, func(string) { close(sent) }, &starts)
	rm.engines["source"].cancel() // the source engine is shutting down: ensureRelayWatch cannot start

	ctx, cancel := context.WithCancel(context.Background())
	done := relayWatchSend(rm, ctx, id)
	<-sent
	cancel()
	if got := relayWatchResult(t, done, "wait did not end"); got.err == nil {
		t.Fatalf("dispatcher unexpectedly succeeded: %+v", got.resp)
	}
	time.Sleep(10 * relayDrainSafety)
	select {
	case <-s.closed:
	default:
		t.Fatal("task relay without a watch leaked: neither watch stop nor drain safety closed the session")
	}
	rc, _ := relayWatchRecord(p, id)
	if rc.Status != "failed" {
		t.Fatalf("receipt after the safety timeout: %+v", rc)
	}
}

// #448 P2: a receipt left running by a bridge restart has no live drain, so the watch's
// d == nil branch is the only chance to wake the lead. It must queue one wake.
func TestRelayWatchRestartInterruptionWakesLead(t *testing.T) {
	platform := newProgressPlatform()
	source := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangEnglish)
	allChatsAreWorkspaces(source)
	source.dataDir = t.TempDir()
	if err := source.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	p := source.publicProgress
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		if project != "target" || platformName != "discord" || session != "discord:room:user" {
			return nil, errors.New("unbound test reporter")
		}
		return platform, nil
	}
	run := p.begin(platform, "discord:room:user", LangChinese, nil)
	id, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:room:user", Run: run, Seq: 1, Kind: "start", Title: "local task", Summary: "start"})
	if err != nil {
		t.Fatal(err)
	}
	store := settledTimerStore(t)
	source.timerScheduler = NewTimerScheduler(store)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	// The bridge restarted: the watch loop knows the receipt, but not its in-memory run.
	p.mu.Lock()
	delete(p.relayRuns, d.token)
	p.mu.Unlock()
	p.relayWatchTick(relayWatchReceipt(d).WatchDue)
	p.relayWatchTick(relayWatchReceipt(d).WatchDue) // WatchDone stays true: never a second wake

	jobs := store.List()
	if len(jobs) != 1 {
		t.Fatalf("restart interruption woke the lead %d times, want 1: %+v", len(jobs), jobs)
	}
	job := jobs[0]
	// e0b92ee8 (#623): the receipt waits for the user to go quiet instead of joining a running turn.
	if job.Project != "source" || job.SessionKey != "discord:room:user" || !job.WaitUserQuiet ||
		!strings.Contains(job.Prompt, id) || !strings.Contains(job.Prompt, "桥重启") {
		t.Fatalf("restart wake job %+v", job)
	}
}

// #448 P3 coverage: after the wait ends, a worker that returns normally wakes the lead once,
// with the result text.
func TestTaskRelayDrainResultWakesLead(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	sent, release := make(chan struct{}), make(chan struct{})
	rm, s := taskRelayManager(t, p, platform, func(string) { close(sent); <-release }, &starts)
	store := settledTimerStore(t)
	rm.engines["source"].timerScheduler = NewTimerScheduler(store)
	s.events <- Event{Type: EventText, Content: "halfway there"}
	ctx, cancel := context.WithCancel(context.Background())
	done := relayWatchSend(rm, ctx, id)
	<-sent
	relayWatchWait(t, "text consumed", func() bool { return len(s.events) == 0 })
	cancel()
	if got := relayWatchResult(t, done, "wait did not end"); got.err == nil || !strings.Contains(got.err.Error(), "ten-minute watch") {
		t.Fatalf("dispatcher got %v %v", got.resp, got.err)
	}
	s.events <- Event{Type: EventResult, Content: "final result"}
	close(release)
	relayWatchWait(t, "lead woken", func() bool { return len(store.List()) == 1 })
	job := store.List()[0]
	if job.Project != "source" || job.SessionKey != "discord:room:user" ||
		!strings.Contains(job.Prompt, "已交回结果") || !strings.Contains(job.Prompt, "final result") {
		t.Fatalf("result wake job %+v", job)
	}
}

// #448 P3 coverage: a result event and the watch stop arriving together must still wake the
// lead exactly once (the drain's completion runs once).
func TestTaskRelayDrainResultAndWatchStopWakeLeadOnce(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	sent, release := make(chan struct{}), make(chan struct{})
	rm, s := taskRelayManager(t, p, platform, func(string) { close(sent); <-release }, &starts)
	store := settledTimerStore(t)
	rm.engines["source"].timerScheduler = NewTimerScheduler(store)
	ctx, cancel := context.WithCancel(context.Background())
	done := relayWatchSend(rm, ctx, id)
	<-sent
	cancel()
	if got := relayWatchResult(t, done, "wait did not end"); got.err == nil {
		t.Fatalf("dispatcher unexpectedly succeeded: %+v", got.resp)
	}
	// The result is already buffered when the watch stop closes the run: the drain's stop
	// branch takes it and completes once.
	s.events <- Event{Type: EventResult, Content: "final result"}
	rc, _ := relayWatchRecord(p, id)
	p.relayWatchTick(rc.WatchDue) // first quiet check: one reminder, still running
	rc, _ = relayWatchRecord(p, id)
	if rc.WatchDone || !rc.WatchNudged {
		t.Fatalf("first quiet check did not grant the reminder window: %+v", rc)
	}
	p.relayWatchTick(rc.WatchDue) // reminder window also quiet: stop
	close(release)
	relayWatchWait(t, "lead woken", func() bool { return len(store.List()) > 0 })
	time.Sleep(100 * time.Millisecond)
	if jobs := store.List(); len(jobs) != 1 {
		t.Fatalf("result+stop woke the lead %d times, want 1: %+v", len(jobs), jobs)
	}
	if rc, _ := relayWatchRecord(p, id); rc.Status != "done" || rc.Response != "final result" {
		t.Fatalf("receipt after result+stop: %+v", rc)
	}
}
