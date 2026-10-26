package core

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// threadArchiveTestPlatform records the terminal task threads the sweep asks
// it to archive. It embeds the regular public-progress fixture so the card
// and fact delivery paths stay the real ones.
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

// makeTerminalCard produces a card in the requested state, delivered to the
// platform, so the sweep sees the same record a running bridge would.
func makeTerminalCard(t *testing.T, p *PublicProgress, platform Platform, state string) string {
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

func TestTaskThreadArchiveOnlyTerminalStatesAfterDelay(t *testing.T) {
	for _, tc := range []struct {
		state   string
		archive bool
	}{
		{"in_progress", false},
		{"waiting_user", false},
		{"result_ready", false},
		{"failed", true},
		{"cancelled", true},
		{"completed", true},
	} {
		t.Run(tc.state, func(t *testing.T) {
			p, platform := newArchiveProgress(t)
			id := makeTerminalCard(t, p, platform, tc.state)
			now := time.Now().UTC()

			p.archiveFinishedThreads(context.Background(), now.Add(23*time.Hour))
			if got := platform.archivedTasks(); len(got) != 0 {
				t.Fatalf("archived before the 24h default: %v", got)
			}

			p.archiveFinishedThreads(context.Background(), now.Add(25*time.Hour))
			got := platform.archivedTasks()
			if tc.archive {
				if len(got) != 1 || got[0] != id {
					t.Fatalf("archived = %v, want [%s]", got, id)
				}
			} else if len(got) != 0 {
				t.Fatalf("non-terminal state archived: %v", got)
			}
			task, ok := p.Task(id)
			if !ok {
				t.Fatal("task disappeared")
			}
			if tc.archive && task.ThreadArchivedAt == nil {
				t.Fatal("archived task did not persist thread_archived_at")
			}
			if !tc.archive && task.ThreadArchivedAt != nil {
				t.Fatal("non-terminal task was marked archived")
			}
		})
	}
}

func TestTaskThreadArchiveSkipsUserThreadAndRunsOnce(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeTerminalCard(t, p, platform, "failed")

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
	id := makeTerminalCard(t, p, platform, "completed")
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
	makeTerminalCard(t, p, platform, "completed")

	p.archiveFinishedThreads(context.Background(), time.Now().Add(30*24*time.Hour))
	if got := platform.archivedTasks(); len(got) != 0 {
		t.Fatalf("disabled sweep archived: %v", got)
	}
}

func TestTaskThreadArchiveMarkerSurvivesRestart(t *testing.T) {
	p, platform := newArchiveProgress(t)
	id := makeTerminalCard(t, p, platform, "cancelled")
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
