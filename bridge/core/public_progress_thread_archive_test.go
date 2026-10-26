package core

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

// threadArchiveTestPlatform records the task threads the sweep asks it to
// archive. It embeds the regular public-progress fixture so the card and fact
// delivery paths stay the real ones.
type threadArchiveTestPlatform struct {
	*progressTestPlatform
	mu             sync.Mutex
	archived       []string
	err            error
	factErr        error
	activity       time.Time
	activityErr    error
	threadArchived map[string]bool
	reopened       []string
}

func newThreadArchivePlatform() *threadArchiveTestPlatform {
	return &threadArchiveTestPlatform{progressTestPlatform: newProgressPlatform(), threadArchived: map[string]bool{}}
}

func (p *threadArchiveTestPlatform) ArchiveTaskThread(_ context.Context, task *Task) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return p.err
	}
	p.archived = append(p.archived, task.ID)
	p.threadArchived[task.ID] = true
	return nil
}

func (p *threadArchiveTestPlatform) ReopenTaskThread(_ context.Context, task *Task) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.reopened = append(p.reopened, task.ID)
	p.threadArchived[task.ID] = false
	return nil
}

func (p *threadArchiveTestPlatform) TaskThreadLastActivity(_ context.Context, _ *Task) (time.Time, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.activity, p.activityErr
}

func (p *threadArchiveTestPlatform) PublishTaskFact(ctx context.Context, task *Task, ev TaskEvent, lang Language) error {
	p.mu.Lock()
	factErr := p.factErr
	archived := p.threadArchived[task.ID]
	p.mu.Unlock()
	if factErr != nil {
		return factErr
	}
	if archived {
		return fmt.Errorf("%w: %w", ErrTaskFactUndeliverable, ErrDeliveryUnrecoverable)
	}
	return p.progressTestPlatform.PublishTaskFact(ctx, task, ev, lang)
}

func (p *threadArchiveTestPlatform) archivedTasks() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.archived...)
}

func (p *threadArchiveTestPlatform) setArchiveError(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.err = err
}

func (p *threadArchiveTestPlatform) setActivity(at time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.activity = at
}

func (p *threadArchiveTestPlatform) setFactErr(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.factErr = err
}

func (p *threadArchiveTestPlatform) setThreadReopened(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.threadArchived[id] = false
}

func (p *threadArchiveTestPlatform) reopenedTasks() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.reopened...)
}

func (p *threadArchiveTestPlatform) recordedFacts() map[string]TaskEvent {
	p.pm.Lock()
	defer p.pm.Unlock()
	out := make(map[string]TaskEvent, len(p.facts))
	for id, ev := range p.facts {
		out[id] = ev
	}
	return out
}

func newArchiveProgress(t *testing.T) (*PublicProgress, *threadArchiveTestPlatform) {
	t.Helper()
	platform := newThreadArchivePlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	return p, platform
}

// makeCardInState produces a delivered card in the requested state, so the
// sweep sees the same record a running bridge would.
func makeCardInState(t *testing.T, p *PublicProgress, platform Platform, state string) string {
	t.Helper()
	run, id := startCard(t, p, platform, "room:one", "测试任务")
	switch state {
	case "completed":
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "result", Summary: "已完成"}); err != nil {
			t.Fatal(err)
		}
		p.finish(run, "result")
		if _, err := p.Accept(id, "主人"); err != nil {
			t.Fatal(err)
		}
	case "failed":
		p.finish(run, "failed")
	case "cancelled":
		p.finish(run, "cancelled")
	case "in_progress":
		// The start report alone leaves the card in progress.
	case "waiting_user":
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "waiting", Summary: "等你决定"}); err != nil {
			t.Fatal(err)
		}
	case "result_ready":
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "result", Summary: "待验收"}); err != nil {
			t.Fatal(err)
		}
	default:
		t.Fatalf("unknown state %q", state)
	}
	p.Flush(context.Background())
	return id
}

// setTaskUpdatedAt pins the update timestamp so wait boundaries are exact.
func setTaskUpdatedAt(t *testing.T, p *PublicProgress, id string, at time.Time) {
	t.Helper()
	p.mu.Lock()
	r := p.records[id]
	p.mu.Unlock()
	if r == nil {
		t.Fatalf("task %s not found", id)
	}
	r.mu.Lock()
	r.record.Task.UpdatedAt = at
	r.mu.Unlock()
}

func TestTaskThreadArchiveStateDelays(t *testing.T) {
	for _, tc := range []struct {
		state string
		wait  time.Duration
	}{
		{"in_progress", 0},
		{"waiting_user", 0},
		{"failed", defaultTaskThreadArchiveAfter},
		{"cancelled", defaultTaskThreadArchiveAfter},
		{"completed", defaultTaskThreadArchiveAfter},
		{"result_ready", defaultResultReadyThreadArchiveAfter},
	} {
		t.Run(tc.state, func(t *testing.T) {
			p, platform := newArchiveProgress(t)
			id := makeCardInState(t, p, platform, tc.state)
			at := time.Now().UTC()
			setTaskUpdatedAt(t, p, id, at)

			if tc.wait == 0 {
				p.archiveFinishedThreads(context.Background(), at.Add(30*24*time.Hour))
				if got := platform.archivedTasks(); len(got) != 0 {
					t.Fatalf("state %s archived: %v", tc.state, got)
				}
			} else {
				p.archiveFinishedThreads(context.Background(), at.Add(tc.wait-time.Minute))
				if got := platform.archivedTasks(); len(got) != 0 {
					t.Fatalf("archived one minute before the %s wait: %v", tc.wait, got)
				}
				p.archiveFinishedThreads(context.Background(), at.Add(tc.wait))
				if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
					t.Fatalf("archived at the %s wait = %v, want [%s]", tc.wait, got, id)
				}
			}

			task, ok := p.Task(id)
			if !ok {
				t.Fatal("task disappeared")
			}
			if task.State != TaskState(tc.state) {
				t.Fatalf("state changed to %q, want %q", task.State, tc.state)
			}
			if archived := task.ThreadArchivedAt != nil; archived != (tc.wait > 0) {
				t.Fatalf("thread_archived_at set = %v, want %v", archived, tc.wait > 0)
			}
		})
	}
}

// Archiving a result_ready thread must only hide it; the card is still
// result_ready and the owner can accept it afterwards.
func TestTaskThreadArchiveResultReadyKeepsCardState(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "result_ready")
	before, ok := p.Task(id)
	if !ok {
		t.Fatal("task not found")
	}
	at := time.Now().UTC()
	setTaskUpdatedAt(t, p, id, at)

	p.archiveFinishedThreads(context.Background(), at.Add(defaultResultReadyThreadArchiveAfter))
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("archived = %v, want [%s]", got, id)
	}

	after, _ := p.Task(id)
	if after.State != TaskStateResultReady {
		t.Fatalf("archive changed state to %q, want result_ready", after.State)
	}
	if after.ResultSummary != before.ResultSummary || after.LatestProgress != before.LatestProgress {
		t.Fatal("archive changed the card's result text")
	}
	if len(after.Events) != len(before.Events) {
		t.Fatalf("archive appended events: %d -> %d", len(before.Events), len(after.Events))
	}
	accepted, err := p.Accept(id, "主人")
	if err != nil {
		t.Fatalf("result_ready card no longer acceptable: %v", err)
	}
	if accepted.State != TaskStateCompleted {
		t.Fatalf("accept after archive = %q, want completed", accepted.State)
	}
}

func TestTaskThreadArchiveResultReadyCanBeDisabled(t *testing.T) {
	p, platform := newArchiveProgress(t)
	p.SetResultReadyThreadArchiveAfter(0)
	id := makeCardInState(t, p, platform, "result_ready")
	at := time.Now().UTC()
	setTaskUpdatedAt(t, p, id, at)

	p.archiveFinishedThreads(context.Background(), at.Add(30*24*time.Hour))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("disabled result_ready archive ran: %v", got)
	}

	// Terminal archiving is a separate switch and keeps working.
	failedID := makeCardInState(t, p, platform, "failed")
	failedAt := time.Now().UTC()
	setTaskUpdatedAt(t, p, failedID, failedAt)
	p.archiveFinishedThreads(context.Background(), failedAt.Add(defaultTaskThreadArchiveAfter))
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != failedID {
		t.Fatalf("terminal archived = %v, want [%s]", got, failedID)
	}
}

func TestTaskThreadArchiveResultReadySkipsUserThreadAndRunsOnce(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "result_ready")
	at := time.Now().UTC()
	setTaskUpdatedAt(t, p, id, at)

	p.mu.Lock()
	r := p.records[id]
	p.mu.Unlock()
	r.mu.Lock()
	r.record.Task.ThreadID = r.record.Task.ChannelID // the card lives in the user's own thread
	r.mu.Unlock()

	p.archiveFinishedThreads(context.Background(), at.Add(defaultResultReadyThreadArchiveAfter))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("archived the user's own thread: %v", got)
	}

	r.mu.Lock()
	r.record.Task.ThreadID = "thread-" + id
	r.mu.Unlock()
	p.archiveFinishedThreads(context.Background(), at.Add(defaultResultReadyThreadArchiveAfter))
	p.archiveFinishedThreads(context.Background(), at.Add(2*defaultResultReadyThreadArchiveAfter))
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("archived = %v, want exactly once for %s", got, id)
	}
}

func TestTaskThreadArchiveResultReadyWaitsForPendingDelivery(t *testing.T) {
	p, platform := newArchiveProgress(t)
	run, id := startCard(t, p, platform, "room:one", "待验收的任务")
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "result", Summary: "待验收"}); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC()
	setTaskUpdatedAt(t, p, id, at)

	// Result_ready but its card/final fact are still pending: archiving now
	// would make the platform refuse that final public message.
	p.archiveFinishedThreads(context.Background(), at.Add(defaultResultReadyThreadArchiveAfter))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("archived before final delivery: %v", got)
	}

	p.Flush(context.Background())
	p.archiveFinishedThreads(context.Background(), at.Add(defaultResultReadyThreadArchiveAfter))
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("after delivery archived = %v, want [%s]", got, id)
	}
}

func TestTaskThreadArchiveSkipsUserThreadAndRunsOnce(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "failed")

	p.mu.Lock()
	r := p.records[id]
	p.mu.Unlock()
	r.mu.Lock()
	r.record.Task.ThreadID = r.record.Task.ChannelID // the card lives in the user's own thread
	r.mu.Unlock()

	p.archiveFinishedThreads(context.Background(), time.Now().Add(25*time.Hour))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("archived the user's own thread: %v", got)
	}

	r.mu.Lock()
	r.record.Task.ThreadID = "thread-" + id
	r.mu.Unlock()
	p.archiveFinishedThreads(context.Background(), time.Now().Add(25*time.Hour))
	p.archiveFinishedThreads(context.Background(), time.Now().Add(48*time.Hour))
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("archived = %v, want exactly once for %s", got, id)
	}
}

func TestTaskThreadArchiveRetriesFailedCall(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "completed")
	platform.setArchiveError(errors.New("missing access"))

	p.archiveFinishedThreads(context.Background(), time.Now().Add(25*time.Hour))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("failure still recorded as archived: %v", got)
	}
	task, _ := p.Task(id)
	if task.ThreadArchivedAt != nil {
		t.Fatal("failed archive persisted thread_archived_at")
	}

	platform.setArchiveError(nil)
	p.archiveFinishedThreads(context.Background(), time.Now().Add(26*time.Hour))
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("retry archived = %v, want [%s]", got, id)
	}
}

func TestTaskThreadArchiveWaitsForPendingDelivery(t *testing.T) {
	p, platform := newArchiveProgress(t)
	run, id := startCard(t, p, platform, "room:one", "失败的任务")
	p.finish(run, "failed")

	// Terminal but its card/final fact are still pending: archiving now would
	// make the platform refuse that final public message.
	p.archiveFinishedThreads(context.Background(), time.Now().Add(25*time.Hour))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("archived before final delivery: %v", got)
	}

	p.Flush(context.Background())
	p.archiveFinishedThreads(context.Background(), time.Now().Add(26*time.Hour))
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("after delivery archived = %v, want [%s]", got, id)
	}
}

func TestTaskThreadArchiveCanBeDisabled(t *testing.T) {
	p, platform := newArchiveProgress(t)
	p.SetThreadArchiveAfter(0)
	makeCardInState(t, p, platform, "completed")

	p.archiveFinishedThreads(context.Background(), time.Now().Add(30*24*time.Hour))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("disabled sweep archived: %v", got)
	}
}

func TestTaskThreadArchiveMarkerSurvivesRestart(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "cancelled")
	p.archiveFinishedThreads(context.Background(), time.Now().Add(25*time.Hour))
	if got := platform.archivedTasks(); len(got) != 1 {
		t.Fatalf("first archive = %v", got)
	}

	restored, err := NewPublicProgress(p.dataDir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	restored.archiveFinishedThreads(context.Background(), time.Now().Add(30*time.Hour))
	if got := platform.archivedTasks(); len(got) != 1 {
		t.Fatalf("restart archived again: %v", got)
	}
	task, ok := restored.Task(id)
	if !ok || task.ThreadArchivedAt == nil {
		t.Fatal("restart lost thread_archived_at")
	}
}

// A reply or reopen after the card's last progress event restarts the wait;
// the same sweep must not hide the thread it just reopened.
func TestTaskThreadArchiveWaitsForThreadActivityAfterReopen(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "result_ready")
	at := time.Now().UTC()
	setTaskUpdatedAt(t, p, id, at)
	activity := at.Add(2 * time.Hour)
	platform.setActivity(activity)

	p.archiveFinishedThreads(context.Background(), at.Add(defaultResultReadyThreadArchiveAfter))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("archived a thread active after the card update: %v", got)
	}

	p.archiveFinishedThreads(context.Background(), activity.Add(defaultResultReadyThreadArchiveAfter))
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("archived after activity+wait = %v, want [%s]", got, id)
	}
}

// Accept is the common key fact that arrives after the sweep archived the
// thread. It must reopen the thread, deliver the acceptance, and clear the
// archived marker so the thread can be managed again.
func TestTaskThreadAcceptAfterArchiveReopensAndDeliversFact(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "result_ready")
	at := time.Now().UTC()
	setTaskUpdatedAt(t, p, id, at)
	p.archiveFinishedThreads(context.Background(), at.Add(defaultResultReadyThreadArchiveAfter))
	before, ok := p.Task(id)
	if !ok || before.ThreadArchivedAt == nil {
		t.Fatal("thread marker not set after archive")
	}

	if _, err := p.Accept(id, "主人"); err != nil {
		t.Fatalf("accept after archive: %v", err)
	}
	p.Flush(context.Background())

	after, ok := p.Task(id)
	if !ok || after.State != TaskStateCompleted {
		t.Fatalf("state after accept = %+v, want completed", after)
	}
	if after.ThreadArchivedAt != nil {
		t.Fatal("thread_archived_at not cleared after acceptance delivery")
	}
	if got := platform.reopenedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("reopened = %v, want [%s]", got, id)
	}
	accepted := false
	for _, ev := range platform.recordedFacts() {
		if ev.Kind == TaskEventCompleted && ev.IsKeyFact {
			accepted = true
		}
	}
	if !accepted {
		t.Fatal("acceptance fact was not delivered after reopening the thread")
	}
}

// A thread the bridge archived was reopened by a reply or by hand. The marker
// must not freeze it as "already archived": after the new activity's wait it
// has to be archived again.
func TestTaskThreadArchiveReArmsAfterReplyOrReopen(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "result_ready")
	at := time.Now().UTC()
	setTaskUpdatedAt(t, p, id, at)
	wait := defaultResultReadyThreadArchiveAfter

	first := at.Add(wait)
	p.archiveFinishedThreads(context.Background(), first)
	if got := platform.archivedTasks(); len(got) != 1 || got[0] != id {
		t.Fatalf("first archive = %v, want [%s]", got, id)
	}

	reply := first.Add(2 * time.Hour)
	platform.setActivity(reply)
	platform.setThreadReopened(id)

	p.archiveFinishedThreads(context.Background(), reply.Add(wait-time.Minute))
	if got := platform.archivedTasks(); len(got) != 1 {
		t.Fatalf("archived before the reply's wait elapsed: %v", got)
	}
	task, ok := p.Task(id)
	if !ok || task.ThreadArchivedAt != nil {
		t.Fatal("thread_archived_at not cleared after the thread was reopened")
	}

	p.archiveFinishedThreads(context.Background(), reply.Add(wait))
	if got := platform.archivedTasks(); len(got) != 2 || got[1] != id {
		t.Fatalf("second archive = %v, want the same thread archived again", got)
	}
	task, ok = p.Task(id)
	if !ok || task.ThreadArchivedAt == nil {
		t.Fatal("thread_archived_at not set after the second archive")
	}

	// A third sweep must not call archive again while the thread is still
	// archived and has no newer activity.
	p.archiveFinishedThreads(context.Background(), reply.Add(2*wait))
	if got := platform.archivedTasks(); len(got) != 2 {
		t.Fatalf("re-archived without new activity: %v", got)
	}
}

// A retryable failure while delivering the acceptance must keep the accepted
// fact pending; the next Flush can still post it.
func TestTaskThreadAcceptAfterArchiveKeepsFactPendingOnRetryableFailure(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeCardInState(t, p, platform, "result_ready")
	at := time.Now().UTC()
	setTaskUpdatedAt(t, p, id, at)
	p.archiveFinishedThreads(context.Background(), at.Add(defaultResultReadyThreadArchiveAfter))
	beforeFacts := len(platform.recordedFacts())

	platform.setFactErr(errors.New("discord: rate limited"))
	if _, err := p.Accept(id, "主人"); err != nil {
		t.Fatalf("accept after archive: %v", err)
	}
	p.Flush(context.Background())

	p.mu.Lock()
	pending := p.pending[id] != nil
	p.mu.Unlock()
	if !pending {
		t.Fatal("retryable failure dropped the pending acceptance")
	}
	task, ok := p.Task(id)
	if !ok || task.State != TaskStateCompleted {
		t.Fatalf("state after accept = %+v, want completed", task)
	}
	if task.ThreadArchivedAt != nil {
		t.Fatal("thread_archived_at not cleared before retrying the acceptance")
	}
	if got := len(platform.recordedFacts()); got != beforeFacts {
		t.Fatalf("failed fact was recorded as delivered: %d -> %d", beforeFacts, got)
	}

	platform.setFactErr(nil)
	p.Flush(context.Background())
	if got := len(platform.recordedFacts()); got != beforeFacts+1 {
		t.Fatalf("retry delivered %d facts, want %d", got, beforeFacts+1)
	}
	p.mu.Lock()
	pending = p.pending[id] != nil
	p.mu.Unlock()
	if pending {
		t.Fatal("pending acceptance was not cleared after successful retry")
	}
}
