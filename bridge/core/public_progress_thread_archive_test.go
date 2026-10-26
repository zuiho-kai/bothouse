package core

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// threadArchiveTestPlatform records the task threads the sweep asks it to
// archive. It embeds the regular public-progress fixture so the card and fact
// delivery paths stay the real ones.
type threadArchiveTestPlatform struct {
	*progressTestPlatform
	mu       sync.Mutex
	archived []string
	err      error
}

func newThreadArchivePlatform() *threadArchiveTestPlatform {
	return &threadArchiveTestPlatform{progressTestPlatform: newProgressPlatform()}
}

func (p *threadArchiveTestPlatform) ArchiveTaskThread(_ context.Context, task *Task) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return p.err
	}
	p.archived = append(p.archived, task.ID)
	return nil
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
