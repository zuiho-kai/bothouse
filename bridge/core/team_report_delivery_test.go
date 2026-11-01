package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// reportTestPlatform records sends and can reject the next N of them.
type reportTestPlatform struct {
	exitTestPlatform
	failSends int
}

func (p *reportTestPlatform) ReconstructReplyCtx(key string) (any, error) { return key, nil }

func (p *reportTestPlatform) Send(ctx context.Context, rc any, content string) error {
	p.mu.Lock()
	if p.failSends > 0 {
		p.failSends--
		p.mu.Unlock()
		return errors.New("platform rejected the post")
	}
	p.mu.Unlock()
	return p.exitTestPlatform.Send(ctx, rc, content)
}

func reportFixture(t *testing.T) (*Engine, *reportTestPlatform) {
	t.Helper()
	e, _, _ := exitFixture(t, nil)
	p := &reportTestPlatform{exitTestPlatform: exitTestPlatform{
		inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}},
	}}
	e.platforms = []Platform{p}
	return e, p
}

func pendingReportForTest(key string) *pendingReport {
	return &pendingReport{
		Key:       key,
		JobID:     "job-" + key,
		Platform:  "discord",
		Chat:      "chat1",
		Workspace: "ws1",
		Bot:       "橘",
		Kind:      exitKindReport,
		Body:      "任务24：看门修复完成\n细节留在工作区",
		Session:   exitWSKey,
		CreatedAt: time.Now(),
	}
}

// TestReportWakeSilentLeadFallsBackToOriginal reproduces the reported gap: the lead's turn
// produced nothing, and the workspace result has no headline in the chat, so it must be posted
// as the 📬 record instead of disappearing.
func TestReportWakeSilentLeadFallsBackToOriginal(t *testing.T) {
	e, p := reportFixture(t)
	if !e.rememberReport(pendingReportForTest("r1")) {
		t.Fatal("report not recorded")
	}
	e.settleReportRecord("r1", "", nil)

	sent := p.sentTo("discord:chat1")
	if len(sent) != 1 || !strings.HasPrefix(sent[0], "📬") || !strings.Contains(sent[0], "看门修复完成") {
		t.Fatalf("fallback post = %#v", sent)
	}
	// Delivered: a repeated event must not post the same report again.
	e.settleReportRecord("r1", "", nil)
	if got := p.sentTo("discord:chat1"); len(got) != 1 {
		t.Fatalf("report posted twice: %#v", got)
	}
	if !e.reportSeenRecently("r1") {
		t.Fatal("delivered report should stay as a dedupe record")
	}
}

// TestReportWakeVisibleLeadClearsPending: the lead's own answer is the report; no fallback.
func TestReportWakeVisibleLeadClearsPending(t *testing.T) {
	e, p := reportFixture(t)
	e.rememberReport(pendingReportForTest("r2"))
	e.settleReportRecord("r2", "看门修复已完成，还差独立审核，审核任务已派出。", nil)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("fallback posted over the lead's report: %#v", got)
	}
}

// TestReportWakePostedHeadlineSilentIsComplete: #623 lets the lead add nothing when the
// headline is already in the chat; that is not a lost report.
func TestReportWakePostedHeadlineSilentIsComplete(t *testing.T) {
	e, p := reportFixture(t)
	rec := pendingReportForTest("r3")
	rec.Posted = true
	e.rememberReport(rec)
	e.settleReportRecord("r3", "", nil)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("fallback after a posted headline: %#v", got)
	}
}

// TestReportWakeRetriesWhenFallbackSendFails: a rejected fallback keeps the record and retries.
func TestReportWakeRetriesWhenFallbackSendFails(t *testing.T) {
	e, p := reportFixture(t)
	e.rememberReport(pendingReportForTest("r4"))
	p.failSends = 1
	e.settleReportRecord("r4", "", nil)

	e.teamExit.mu.Lock()
	rec := e.teamExit.reports["r4"]
	attempts, delivered, lastErr := rec.Attempts, rec.delivered(), rec.LastError
	e.teamExit.mu.Unlock()
	if delivered || attempts != 1 || lastErr == "" {
		t.Fatalf("failed fallback not kept for retry: attempts=%d delivered=%v err=%q", attempts, delivered, lastErr)
	}

	e.settleReportRecord("r4", "", nil)
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "看门修复完成") {
		t.Fatalf("retry did not post: %#v", got)
	}
}

// TestHeadlinePostFailureFallsBackToOriginal: the headline marker used to be written before the
// send, so a rejected post blocked the retry for an hour and dropped the report.
func TestHeadlinePostFailureFallsBackToOriginal(t *testing.T) {
	e, p := reportFixture(t)
	p.failSends = 1
	item := &teamTaskBoardItem{ID: 5, Who: "orange", What: "改桥"}
	e.postExitHeadline(p, "discord:chat1", "chat1", "ws1", "橘", exitKindReport,
		"[report] #5 看门修复完成\n细节留在工作区", exitWSKey, 5, "看门修复完成", item)

	sent := p.sentTo("discord:chat1")
	if len(sent) != 1 || !strings.HasPrefix(sent[0], "📬") || !strings.Contains(sent[0], "细节留在工作区") {
		t.Fatalf("fallback after a rejected headline = %#v", sent)
	}
}

// TestHeadlineFallbackFailureKeepsRecord: when the headline and its immediate 📬 fallback are
// both rejected, the result must be persisted for the recovery sweep, not dropped.
func TestHeadlineFallbackFailureKeepsRecord(t *testing.T) {
	e, p := reportFixture(t)
	p.failSends = 2
	item := &teamTaskBoardItem{ID: 6, Who: "orange", What: "改桥"}
	e.postExitHeadline(p, "discord:chat1", "chat1", "ws1", "橘", exitKindReport,
		"[report] #6 看门修复完成\n细节留在工作区", exitWSKey, 6, "看门修复完成", item)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("unexpected post while both sends fail: %#v", got)
	}
	key := reportKey("discord", "chat1", "ws1", exitKindReport, 6, "[report] #6 看门修复完成\n细节留在工作区")
	e.teamExit.mu.Lock()
	rec := e.teamExit.reports[key]
	attempts, lastErr := 0, ""
	if rec != nil {
		attempts, lastErr = rec.Attempts, rec.LastError
		rec.CreatedAt = time.Now().Add(-3 * time.Minute)
		e.saveReportsLocked()
	}
	e.teamExit.mu.Unlock()
	if rec == nil || attempts != 1 || lastErr == "" {
		t.Fatal("failed headline fallback was not kept for retry")
	}
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "细节留在工作区") {
		t.Fatalf("recovery did not post the kept result: %#v", got)
	}
}

// TestReportRecoveryAfterRestart: a record left by a stopped bridge with no live wake job is
// delivered at scheduler start.
func TestReportRecoveryAfterRestart(t *testing.T) {
	e, p := reportFixture(t)
	rec := pendingReportForTest("r6")
	rec.CreatedAt = time.Now().Add(-3 * time.Minute)
	e.rememberReport(rec)
	e.recoverPendingReports(false)
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "看门修复完成") {
		t.Fatalf("restart recovery did not post: %#v", got)
	}
}

// TestReportRecentDeadWakeRecoveredAtStart reproduces the P1: a record younger than the grace
// window whose wake already fired (or is gone) was skipped at start and then never retried,
// because the minute sweep only looked at LastError.
func TestReportRecentDeadWakeRecoveredAtStart(t *testing.T) {
	e, p := reportFixture(t)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.timerScheduler = NewTimerScheduler(store)
	rec := pendingReportForTest("r11")
	rec.CreatedAt = time.Now() // younger than teamReportRecoveryGrace
	e.rememberReport(rec)
	e.recoverPendingReports(false)
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "看门修复完成") {
		t.Fatalf("recent dead-wake record was not recovered at start: %#v", got)
	}
}

// TestReportStartLeavesLiveWakeAlone: the scheduler re-armed the job, so its turn may still
// deliver the report; posting now would duplicate it.
func TestReportStartLeavesLiveWakeAlone(t *testing.T) {
	e, p := reportFixture(t)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.timerScheduler = NewTimerScheduler(store)
	if err := store.Add(&TimerJob{ID: "job-r12", Project: "orange", SessionKey: "discord:chat1",
		ScheduledAt: time.Now().Add(time.Hour), Prompt: "x"}); err != nil {
		t.Fatal(err)
	}
	rec := pendingReportForTest("r12")
	rec.CreatedAt = time.Now().Add(-3 * time.Minute)
	e.rememberReport(rec)
	e.recoverPendingReports(false)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("start recovery posted over a live wake: %#v", got)
	}
}

// TestReportPeriodicSweepRetriesDeadWake: a record with no failed attempt may still be a wake
// queued behind a busy session, so the sweep must leave a live wake alone. Once the wake is
// gone, the sweep must post it even though LastError is empty.
func TestReportPeriodicSweepRetriesDeadWake(t *testing.T) {
	e, p := reportFixture(t)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.timerScheduler = NewTimerScheduler(store)
	if err := store.Add(&TimerJob{ID: "job-r8", Project: "orange", SessionKey: "discord:chat1",
		ScheduledAt: time.Now().Add(time.Hour), Prompt: "x"}); err != nil {
		t.Fatal(err)
	}
	rec := pendingReportForTest("r8")
	rec.CreatedAt = time.Now().Add(-3 * time.Minute)
	e.rememberReport(rec)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("periodic sweep posted a still-queued wake: %#v", got)
	}
	store.MarkFired("job-r8", nil)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "看门修复完成") {
		t.Fatalf("periodic sweep did not retry a dead wake without LastError: %#v", got)
	}
}

// TestReportSettlesBetweenPersistAndEnqueue reproduces the P2: AddJob runs a due job at once,
// so its turn can settle before the queue call returns. The record must be persisted first;
// a settle before the record is written finds nothing, and the later record is never retried.
func TestReportSettlesBetweenPersistAndEnqueue(t *testing.T) {
	e, p := reportFixture(t)
	rec := pendingReportForTest("r13")
	var enqueued bool
	ok := e.queueReportWake(&TimerJob{ID: rec.JobID}, rec, func(*TimerJob) error {
		enqueued = true
		e.settleReportRecord(rec.Key, "", nil) // the due wake's turn ends with nothing visible
		return nil
	})
	if !ok || !enqueued {
		t.Fatalf("wake not queued: ok=%v enqueued=%v", ok, enqueued)
	}
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "看门修复完成") {
		t.Fatalf("settle between persist and enqueue lost the report: %#v", got)
	}
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 1 {
		t.Fatalf("report posted twice: %#v", got)
	}
}

// TestReportEnqueueFailurePostsNowThenStaysDelivered: when the wake cannot be queued the report
// is posted immediately, and only that accepted post marks it delivered — later sweeps must not
// post it again.
func TestReportEnqueueFailurePostsNowThenStaysDelivered(t *testing.T) {
	e, p := reportFixture(t)
	rec := pendingReportForTest("r14")
	rec.CreatedAt = time.Now().Add(-3 * time.Minute)
	if !e.queueReportWake(&TimerJob{ID: rec.JobID}, rec, func(*TimerJob) error {
		return errors.New("queue closed")
	}) {
		t.Fatal("enqueue failure reported success")
	}
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], "看门修复完成") {
		t.Fatalf("enqueue failure did not post the report: %#v", got)
	}
	e.recoverPendingReports(false)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 1 {
		t.Fatalf("report posted twice: %#v", got)
	}
}

// TestReportEnqueueAndFallbackFailureRetried is the regression for review 5686795473: the wake
// cannot be queued and the platform also rejects the immediate post. The record must stay pending
// (a rejected post is not delivery) and the recovery sweep must send it exactly once.
func TestReportEnqueueAndFallbackFailureRetried(t *testing.T) {
	e, p := reportFixture(t)
	rec := pendingReportForTest("r15")
	rec.CreatedAt = time.Now().Add(-3 * time.Minute)
	p.failSends = 1
	e.queueReportWake(&TimerJob{ID: rec.JobID}, rec, func(*TimerJob) error {
		return errors.New("queue closed")
	})
	e.teamExit.mu.Lock()
	got := e.teamExit.reports["r15"]
	delivered, attempts, lastErr, jobID := got.delivered(), got.Attempts, got.LastError, got.JobID
	e.teamExit.mu.Unlock()
	if delivered || attempts != 1 || lastErr == "" || jobID != "" {
		t.Fatalf("rejected post recorded as delivery: delivered=%v attempts=%d err=%q job=%q",
			delivered, attempts, lastErr, jobID)
	}
	if sent := p.sentTo("discord:chat1"); len(sent) != 0 {
		t.Fatalf("rejected post counted as sent: %#v", sent)
	}
	e.recoverPendingReports(true)
	if sent := p.sentTo("discord:chat1"); len(sent) != 1 || !strings.Contains(sent[0], "看门修复完成") {
		t.Fatalf("recovery did not retry the report: %#v", sent)
	}
	e.recoverPendingReports(true)
	if sent := p.sentTo("discord:chat1"); len(sent) != 1 {
		t.Fatalf("report posted twice: %#v", sent)
	}
}

// TestReportEnqueueFailureKeepsDedupeForRepeat: until a post is accepted, the same handback
// arriving again must not queue a second wake or post a second copy.
func TestReportEnqueueFailureKeepsDedupeForRepeat(t *testing.T) {
	e, p := reportFixture(t)
	rec := pendingReportForTest("r16")
	p.failSends = 1
	e.queueReportWake(&TimerJob{ID: rec.JobID}, rec, func(*TimerJob) error {
		return errors.New("queue closed")
	})
	if !e.reportSeenRecently("r16") {
		t.Fatal("a report whose post was rejected must still dedupe a repeated handback")
	}
	e.recoverPendingReports(false)
	if sent := p.sentTo("discord:chat1"); len(sent) != 1 {
		t.Fatalf("recovery after a repeated handback = %#v, want one post", sent)
	}
}

// TestReportStaleDedupeAllowsNewHandback: a delivered record older than the dedupe window must
// not suppress the same result forever in a long-running bridge.
func TestReportStaleDedupeAllowsNewHandback(t *testing.T) {
	e, _ := reportFixture(t)
	e.rememberReport(pendingReportForTest("r9"))
	e.dropDeliveredReport("r9")
	e.teamExit.mu.Lock()
	e.teamExit.reports["r9"].DeliveredAt = time.Now().Add(-2 * time.Hour)
	e.teamExit.mu.Unlock()
	if !e.rememberReport(pendingReportForTest("r9")) {
		t.Fatal("stale delivered record suppressed a new handback")
	}
}

// TestReportDedupeSameHandback: the same handback is not woken or posted twice.
func TestReportDedupeSameHandback(t *testing.T) {
	e, _ := reportFixture(t)
	if !e.rememberReport(pendingReportForTest("r7")) {
		t.Fatal("first record rejected")
	}
	if e.rememberReport(pendingReportForTest("r7")) {
		t.Fatal("duplicate handback accepted")
	}
}

// TestChatLeadPromptAllowsAuthorizedFollowUp: the prompt used to say 「不要再派回工作区」, which
// contradicted the team rule that an unfinished task keeps its next step.
func TestChatLeadPromptAllowsAuthorizedFollowUp(t *testing.T) {
	p := chatLeadPrompt("", "<#9>", "橘", exitKindReport, "做完了", "", false)
	for _, want := range []string{"尚未安排", "不要把这件活重新派一遍", "花钱、部署、重启", "用户已经停止的任务"} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt lacks %q:\n%s", want, p)
		}
	}
	if strings.Contains(p, "不要再派回工作区") {
		t.Fatalf("contradictory instruction still present:\n%s", p)
	}
}

// Every accepted report path must preserve PR800: delivery is pending verification,
// never completion. Use the actual bundled board command against isolated data.
func TestReportDeliveryLeavesPendingVerification(t *testing.T) {
	for _, mode := range []string{"headline", "fallback", "summary", "enqueue-failure", "restart"} {
		t.Run(mode, func(t *testing.T) {
			e, p := reportFixture(t)
			e.SetTeam(t.TempDir(), "lead", true)
			gate, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(gate, filepath.Join(e.dataDir, "gate")); err != nil {
				t.Fatal(err)
			}
			item := teamTaskBoardItem{ID: 46, What: "验证报告", Chat: "discord:chat1", WS: exitWSKey, Dispatcher: e.name}
			writeReviewBoard(t, e, item)
			rec := pendingReportForTest("lifecycle")
			rec.Board = 46
			switch mode {
			case "headline":
				e.postExitHeadline(p, "discord:chat1", "chat1", "ws1", "橘", exitKindReport, rec.Body, exitWSKey, 46, "结果已交回", &item)
			case "enqueue-failure":
				e.queueReportWake(&TimerJob{}, rec, func(*TimerJob) error { return errors.New("queue unavailable") })
			default:
				e.rememberReport(rec)
				if mode == "restart" {
					e.teamExit.mu.Lock()
					e.teamExit.reportsLoaded = false
					e.teamExit.reports = nil
					e.teamExit.mu.Unlock()
					e.recoverPendingReports(false)
				} else {
					text := ""
					if mode == "summary" {
						text = "报告已送达，等待独立验收"
					}
					e.settleReportRecord(rec.Key, text, nil)
				}
			}
			got := e.boardItemByID(46)
			if got == nil || got.ReturnedAt.IsZero() || got.DoneAt != "" {
				t.Fatalf("%s did not leave pending verification: %+v", mode, got)
			}
			if !e.exitReportedBefore(46) {
				t.Fatal("missing delivery receipt for board recovery")
			}
		})
	}
}

// Drive the real message/agent result/send path; only the agent and platform are fakes.
func TestCUJ_ReportWakeDeliveryReceipt(t *testing.T) {
	for _, mode := range []string{"summary", "silent", "send-rejected"} {
		t.Run(mode, func(t *testing.T) {
			e, p := reportFixture(t)
			a := e.agent.(*inputTestAgent)
			store, err := NewTimerStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			e.timerScheduler = NewTimerScheduler(store)
			rec := pendingReportForTest("entry")
			job := &TimerJob{ID: rec.JobID, ReportID: rec.Key, Project: e.name, SessionKey: "discord:chat1", Prompt: "汇总结果", ScheduledAt: time.Now().Add(time.Hour)}
			if err := store.Add(job); err != nil {
				t.Fatal(err)
			}
			e.rememberReport(rec)
			e.ReceiveMessage(p, &Message{SessionKey: "discord:chat1", Platform: "discord", ChannelID: "chat1", UserID: "human", Content: job.Prompt, ReplyCtx: "discord:chat1", Mentioned: true, timerJobID: job.ID})
			inputPrompt(t, a)
			text := "汇总结果已送达"
			if mode == "silent" {
				text = "NO_REPLY"
			}
			if mode == "send-rejected" {
				p.mu.Lock()
				p.failSends = 1
				p.mu.Unlock()
			}
			inputDone(a, text)
			inputWait(t, func() bool {
				e.teamExit.mu.Lock()
				defer e.teamExit.mu.Unlock()
				return e.teamExit.reports[rec.Key].delivered()
			})
			sent := p.sentTo("discord:chat1")
			want := text
			if mode != "summary" {
				want = "看门修复完成"
			}
			count := 0
			for _, post := range sent {
				if strings.Contains(post, want) {
					count++
				}
			}
			if count != 1 {
				t.Fatalf("%s: expected exactly one delivered result %q, got %#v", mode, want, sent)
			}
			e.recoverPendingReports(false)
			if got := p.sentTo("discord:chat1"); len(got) != len(sent) {
				t.Fatalf("duplicate after recovery: %#v", got)
			}
		})
	}
}

func TestReportRecoveryDoesNotReviveStoppedTask(t *testing.T) {
	e, p := reportFixture(t)
	e.SetTeam(t.TempDir(), "lead", true)
	rec := pendingReportForTest("stopped")
	rec.Board = 46
	writeReviewBoard(t, e, teamTaskBoardItem{ID: 46, WS: exitWSKey, Paused: "now", PauseWhy: "用户取消"})
	e.rememberReport(rec)
	e.recoverPendingReports(false)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("stopped task posted: %#v", got)
	}
	if got := e.boardItemByID(46); !got.ReturnedAt.IsZero() {
		t.Fatal("stopped task marked returned")
	}
}

func TestReportFiredTimerStillQueuedBehindUser(t *testing.T) {
	e, p := reportFixture(t)
	a := e.agent.(*inputTestAgent)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.timerScheduler = NewTimerScheduler(store)
	e.ReceiveMessage(p, &Message{SessionKey: "discord:chat1", Platform: "discord", ChannelID: "chat1", UserID: "human", Content: "先处理我的话", ReplyCtx: "discord:chat1", Mentioned: true})
	inputPrompt(t, a)
	rec := pendingReportForTest("busy")
	rec.CreatedAt = time.Now().Add(-3 * time.Minute)
	e.rememberReport(rec)
	silent := true
	job := &TimerJob{ID: rec.JobID, ReportID: rec.Key, Project: e.name, SessionKey: "discord:chat1", Prompt: "汇总工作区", Silent: &silent, ScheduledAt: time.Now()}
	if err := store.Add(job); err != nil {
		t.Fatal(err)
	}
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatal(err)
	}
	// executeJob marks the timer fired after ExecuteTimerJob returns queueAccepted.
	store.MarkFired(job.ID, nil)
	e.recoverPendingReports(true)
	for _, sent := range p.sentTo("discord:chat1") {
		if strings.Contains(sent, "看门修复完成") {
			t.Fatalf("recovery overtook queued wake: %s", sent)
		}
	}
	inputDone(a, "用户请求处理完")
	inputPrompt(t, a)
	inputDone(a, "汇总工作区结果")
	inputWait(t, func() bool {
		e.teamExit.mu.Lock()
		defer e.teamExit.mu.Unlock()
		return e.teamExit.reports[rec.Key].delivered()
	})
}
