package core

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// These tests drive the real task relay path (rm.Send -> handleTrackedRelay)
// with the real clock; ticks are passed the receipt's own due time.

type relayWatchSendResult struct {
	resp *RelayResponse
	err  error
}

func relayWatchRecord(p *PublicProgress, id string) (taskRelayRecord, bool) {
	p.mu.Lock()
	r := p.records[id]
	p.mu.Unlock()
	if r == nil {
		return taskRelayRecord{}, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	rc, ok := r.record.Relays["dispatch-one"]
	return rc, ok
}

func relayWatchWait(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting: " + what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func relayWatchSend(rm *RelayManager, ctx context.Context, id string) chan relayWatchSendResult {
	done := make(chan relayWatchSendResult, 1)
	go func() {
		resp, err := rm.Send(ctx, taskRelayRequest(id))
		done <- relayWatchSendResult{resp, err}
	}()
	return done
}

func relayWatchResult(t *testing.T, done chan relayWatchSendResult, what string) relayWatchSendResult {
	t.Helper()
	select {
	case got := <-done:
		return got
	case <-time.After(5 * time.Second):
		t.Fatal("dispatcher still waiting: " + what)
	}
	return relayWatchSendResult{}
}

// The watch stop closes the worker's session at once (no drain, no ten more
// minutes) and hands the text so far back as a failed, partial receipt.
func TestRelayWatchStopClosesSessionAndHandsBackPartial(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	sent := make(chan struct{})
	rm, s := taskRelayManager(t, p, platform, func(string) { close(sent) }, &starts)
	s.events <- Event{Type: EventText, Content: "partial words"}
	done := relayWatchSend(rm, context.Background(), id)
	<-sent
	relayWatchWait(t, "text consumed", func() bool { return len(s.events) == 0 })
	rc, ok := relayWatchRecord(p, id)
	if !ok || rc.Status != "running" || rc.WatchDue.IsZero() {
		t.Fatalf("receipt before the check: %+v %v", rc, ok)
	}
	p.relayWatchTick(rc.WatchDue)
	select {
	case <-s.closed:
		t.Fatal("first quiet check closed the session instead of injecting a reminder")
	default:
	}
	rc, _ = relayWatchRecord(p, id)
	if rc.Status != "running" || rc.WatchDone || !rc.WatchNudged {
		t.Fatalf("receipt after the reminder: %+v", rc)
	}
	p.relayWatchTick(rc.WatchDue)
	got := relayWatchResult(t, done, "the watch stopped the run but Send did not return")
	if got.err == nil || !strings.Contains(got.err.Error(), "十分钟看门停止") || !strings.Contains(got.err.Error(), "partial words") || strings.Contains(got.err.Error(), "do not redispatch") {
		t.Fatalf("dispatcher got %v %v", got.resp, got.err)
	}
	select {
	case <-s.closed:
	default:
		t.Fatal("worker session not closed")
	}
	rc, _ = relayWatchRecord(p, id)
	if rc.Status != "failed" || rc.Response != "partial words" || !strings.Contains(rc.Error, "十分钟看门停止") {
		t.Fatalf("receipt after the stop: %+v", rc)
	}
}

// The first quiet check injects one reminder into the worker's running turn and
// keeps the session alive; only the next quiet window stops it. Regression for
// the 2026-10-26 task-a7d7ce39b0be449e loss (10 files changed, no card report,
// session closed at the first check).
func TestRelayWatchInjectsOneReminderBeforeStopping(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	nudges := make(chan string, 2)
	rm, s := taskRelayManager(t, p, platform, nil, &starts)
	s.onMidTurn = func(prompt string) { nudges <- prompt }
	s.events <- Event{Type: EventText, Content: "work in progress"}
	done := relayWatchSend(rm, context.Background(), id)
	relayWatchWait(t, "text consumed", func() bool { return len(s.events) == 0 })

	rc, ok := relayWatchRecord(p, id)
	if !ok || rc.Status != "running" || rc.WatchDue.IsZero() {
		t.Fatalf("receipt before the first check: %+v %v", rc, ok)
	}
	firstDue := rc.WatchDue
	p.relayWatchTick(firstDue)

	select {
	case got := <-nudges:
		if !strings.Contains(got, "回报") || !strings.Contains(got, "卡") {
			t.Fatalf("reminder does not ask for progress or a blocker: %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first quiet check did not inject a reminder")
	}
	select {
	case <-s.closed:
		t.Fatal("first quiet check closed the session instead of granting a window")
	default:
	}
	rc, _ = relayWatchRecord(p, id)
	if rc.Status != "running" || rc.WatchDone {
		t.Fatalf("receipt after the reminder: %+v", rc)
	}
	if !rc.WatchDue.After(firstDue) {
		t.Fatalf("reminder did not grant a new window: due %v -> %v", firstDue, rc.WatchDue)
	}

	p.relayWatchTick(rc.WatchDue)
	got := relayWatchResult(t, done, "the second quiet check did not stop the run")
	if got.err == nil || !strings.Contains(got.err.Error(), "十分钟看门停止") || !strings.Contains(got.err.Error(), "work in progress") {
		t.Fatalf("dispatcher got %v %v", got.resp, got.err)
	}
	select {
	case extra := <-nudges:
		t.Fatalf("reminder sent more than once: %q", extra)
	default:
	}
	if rc, _ = relayWatchRecord(p, id); rc.Status != "failed" || !rc.WatchDone {
		t.Fatalf("receipt after the stop: %+v", rc)
	}
}

// A worker whose result already arrived when the stop comes is recorded done.
func TestRelayWatchStopAfterResultCountsAsDone(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	sent, release := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() { close(release) })
	rm, s := taskRelayManager(t, p, platform, func(string) { close(sent); <-release }, &starts) // Send still busy
	s.events <- Event{Type: EventResult, Content: "full result"}
	done := relayWatchSend(rm, context.Background(), id)
	<-sent
	relayWatchWait(t, "result consumed", func() bool { return len(s.events) == 0 })
	rc, _ := relayWatchRecord(p, id)
	p.relayWatchTick(rc.WatchDue)
	rc, _ = relayWatchRecord(p, id)
	if rc.Status != "running" || rc.WatchDone || !rc.WatchNudged {
		t.Fatalf("first quiet check did not grant the reminder window: %+v", rc)
	}
	p.relayWatchTick(rc.WatchDue)
	got := relayWatchResult(t, done, "stop after the result")
	if got.err != nil || got.resp == nil || got.resp.Response != "full result" {
		t.Fatalf("dispatcher got %v %v", got.resp, got.err)
	}
	if rc, _ = relayWatchRecord(p, id); rc.Status != "done" || rc.Response != "full result" {
		t.Fatalf("receipt %+v", rc)
	}
}

// An update on the worker's own member row in this window is progress too.
func TestRelayWatchMemberRowCountsAsProgress(t *testing.T) {
	p, _, _, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	due := relayWatchReceipt(d).WatchDue
	d.r.mu.Lock()
	d.r.record.Task.Members = append(d.r.record.Task.Members, TaskMember{ReporterProject: "target", ID: "m1", Name: "Target", Status: "running", StartedAt: due.Add(-time.Minute), UpdatedAt: due.Add(-time.Minute)})
	d.r.mu.Unlock()
	p.relayWatchTick(due)
	if rc := relayWatchReceipt(d); rc.WatchRenewed != 1 || rc.WatchDone {
		t.Fatalf("member row update not counted as progress: %+v", rc)
	}
	p.relayWatchTick(relayWatchReceipt(d).WatchDue) // nothing new in the second window
	if rc := relayWatchReceipt(d); rc.WatchDone || !rc.WatchNudged {
		t.Fatalf("stale member row should get the reminder window: %+v", rc)
	}
	p.relayWatchTick(relayWatchReceipt(d).WatchDue) // the reminder window is quiet too
	if rc := relayWatchReceipt(d); !rc.WatchDone {
		t.Fatalf("stale member row counted again: %+v", rc)
	}
}

func TestRelayWatchPromptNamesTheWatch(t *testing.T) {
	p, _, _, id := taskRelayFixture(t)
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	prompt := d.prompt()
	if !strings.Contains(prompt, "every few minutes") || !strings.Contains(prompt, "ten minutes") || !strings.Contains(prompt, "one reminder") || !strings.Contains(prompt, "stopped") {
		t.Fatalf("prompt does not tell the worker about the reminder and the watch:\n%s", prompt)
	}
}

// No API server, no team lead, no workspace watch: task assign alone brings the watch.
func TestRelayWatchRunsWithoutWorkspaceWatch(t *testing.T) {
	old := watchCheckAfter()
	watchCheckAfterNs.Store(int64(50 * time.Millisecond))
	t.Cleanup(func() { watchCheckAfterNs.Store(int64(old)) })
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	rm, s := taskRelayManager(t, p, platform, nil, &starts)
	s.events <- Event{Type: EventText, Content: "half"}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	got := relayWatchResult(t, relayWatchSend(rm, ctx, id), "no watch ran")
	if got.err == nil || !strings.Contains(got.err.Error(), "十分钟看门停止") {
		t.Fatalf("dispatcher got %v %v", got.resp, got.err)
	}
}

// #429: once the dispatcher stops waiting, the drain's fixed safety limit must
// not end a task relay (the watch keeps it), and the outcome wakes the lead.
func TestTaskRelayDrainOutlivesSafetyLimitAndWakesLead(t *testing.T) {
	old := relayDrainSafety
	relayDrainSafety = 20 * time.Millisecond
	t.Cleanup(func() { relayDrainSafety = old })
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	sent, release := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() { close(release) })
	rm, s := taskRelayManager(t, p, platform, func(string) { close(sent); <-release }, &starts)
	mid := make(chan string, 1)
	s.onMidTurn = func(prompt string) { mid <- prompt }
	store := settledTimerStore(t)
	rm.engines["source"].timerScheduler = NewTimerScheduler(store)
	s.events <- Event{Type: EventText, Content: "halfway there"}
	ctx, cancel := context.WithCancel(context.Background())
	done := relayWatchSend(rm, ctx, id)
	<-sent
	relayWatchWait(t, "text consumed", func() bool { return len(s.events) == 0 })
	cancel()
	got := relayWatchResult(t, done, "wait did not end")
	if got.err == nil || !strings.Contains(got.err.Error(), "ten-minute watch") || !strings.Contains(got.err.Error(), "wake this session") {
		t.Fatalf("dispatcher got %v %v", got.resp, got.err)
	}
	time.Sleep(10 * relayDrainSafety)
	select {
	case <-s.closed:
		t.Fatal("drain safety limit closed a watched task relay")
	default:
	}
	if rc, _ := relayWatchRecord(p, id); rc.Status != "running" {
		t.Fatalf("receipt ended before the watch: %+v", rc)
	}
	if jobs := store.List(); len(jobs) != 0 {
		t.Fatalf("lead woken while the run continues: %+v", jobs)
	}
	rc, _ := relayWatchRecord(p, id)
	p.relayWatchTick(rc.WatchDue) // no progress: inject the one reminder, keep the run
	select {
	case prompt := <-mid:
		if !strings.Contains(prompt, "回报") || !strings.Contains(prompt, "卡") {
			t.Fatalf("drain reminder does not ask for progress or a blocker: %q", prompt)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("drain did not inject the watch reminder")
	}
	rc, _ = relayWatchRecord(p, id)
	if rc.Status != "running" || rc.WatchDone || !rc.WatchNudged {
		t.Fatalf("first quiet check stopped or skipped the reminder: %+v", rc)
	}
	if jobs := store.List(); len(jobs) != 0 {
		t.Fatalf("lead woken during the reminder window: %+v", jobs)
	}
	p.relayWatchTick(rc.WatchDue) // the reminder window is quiet too: stop and wake
	relayWatchWait(t, "lead woken", func() bool { return len(store.List()) == 1 })
	job := store.List()[0]
	if job.Project != "source" || job.SessionKey != "discord:room:user" || !job.InjectIfBusy ||
		!strings.Contains(job.Prompt, id) || !strings.Contains(job.Prompt, "十分钟看门") || !strings.Contains(job.Prompt, "halfway there") {
		t.Fatalf("wake job %+v", job)
	}
}

// A plain relay (no watch) keeps the drain's safety limit.
// recordingPlainSession records Send calls without implementing MidTurnSender.
type recordingPlainSession struct {
	stubAgentSession
	sent []string
}

func (s *recordingPlainSession) Send(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.sent = append(s.sent, prompt)
	return nil
}

func TestInjectRelayReminderPlainSendForClaudeCode(t *testing.T) {
	s := &recordingPlainSession{}
	injectRelayReminder(&claudeNamedAgent{}, s, "please report progress")
	if len(s.sent) != 1 || s.sent[0] != "please report progress" {
		t.Fatalf("claudecode reminder should use Send: %q", s.sent)
	}
}

func TestInjectRelayReminderDropsUnsupportedAgent(t *testing.T) {
	s := &recordingPlainSession{}
	injectRelayReminder(&stubAgent{}, s, "please report progress")
	if len(s.sent) != 0 {
		t.Fatalf("unsupported agent must not get a second turn: %q", s.sent)
	}
}

func TestPlainRelayDrainKeepsSafetyLimit(t *testing.T) {
	old := relayDrainSafety
	relayDrainSafety = 20 * time.Millisecond
	t.Cleanup(func() { relayDrainSafety = old })
	s := newControllableSession("plain")
	e := NewEngine("target", &stubAgent{}, nil, "", LangEnglish)
	ended := make(chan teamWorkOutcome, 1)
	sess := &Session{}
	go e.drainRelaySession(nil, s, sess, NewSessionManager(""), "stub", "relay:k", func(o teamWorkOutcome) { ended <- o }, s.Events(), nil, false, "", nil, nil, nil, nil)
	select {
	case <-ended:
	case <-time.After(5 * time.Second):
		t.Fatal("plain relay drain ignored its safety limit")
	}
}

// settledTimerStore returns a timer store in a temp dir. A wake job is due at once, so the
// scheduler fires it on its own goroutine and saves the store again (MarkFired). Cleanup waits
// for every job to be marked fired before the temp dir is removed; MarkFired saves while it
// holds the store lock, so a fired flag seen under that lock means the write is done.
func settledTimerStore(t *testing.T) *TimerStore {
	t.Helper()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		relayWatchWait(t, "timer jobs fired", func() bool {
			store.mu.Lock()
			defer store.mu.Unlock()
			for _, j := range store.jobs {
				if !j.Fired {
					return false
				}
			}
			return true
		})
	})
	return store
}
