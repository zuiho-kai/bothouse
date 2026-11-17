package core

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"testing/synctest"
	"time"
)

type timerWriteBarrier struct {
	slog.Handler
	entered chan struct{}
	release chan struct{}
}

func (h *timerWriteBarrier) Handle(ctx context.Context, r slog.Record) error {
	if r.Message == "timer: project not found" {
		close(h.entered)
		<-h.release
	}
	return h.Handler.Handle(ctx, r)
}

// The missing-engine path is the writer leaked by heldFixture. Pause exactly
// before MarkFired, rather than hoping a TempDir cleanup races the atomic write.
func TestTimerSchedulerStopWaitsForStoreWrite(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := &timerWriteBarrier{Handler: slog.NewTextHandler(io.Discard, nil),
			entered: make(chan struct{}), release: make(chan struct{})}
		previous := slog.Default()
		slog.SetDefault(slog.New(h))
		defer slog.SetDefault(previous)
		dir := t.TempDir()
		store, err := NewTimerStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		sched := NewTimerScheduler(store)
		job := &TimerJob{ID: "held-wake", Project: "unregistered",
			SessionKey: "discord:chat1", Prompt: "review report", ScheduledAt: time.Now()}
		if err := sched.AddJob(job); err != nil {
			t.Fatal(err)
		}
		<-h.entered
		stopped := make(chan struct{})
		go func() { sched.Stop(); close(stopped) }()
		synctest.Wait()
		select {
		case <-stopped:
			t.Error("Stop returned while the timer callback still owns a pending store write")
		default:
		}
		close(h.release)
		<-stopped
		synctest.Wait()
		disk, err := NewTimerStore(dir)
		if err != nil {
			t.Fatal(err)
		}
		if got := disk.Get(job.ID); got == nil || !got.Fired || got.LastError == "" {
			t.Fatalf("missing durable missing-engine receipt after Stop: %+v", got)
		}
	})
}

type timerBlockedPlatform struct {
	stubPlatformEngine
	entered chan struct{}
	release chan struct{}
}

func (p *timerBlockedPlatform) ReconstructReplyCtx(string) (any, error) {
	close(p.entered)
	<-p.release
	return nil, errors.New("test platform released during shutdown")
}

// main stops the scheduler before its engines. Waiting for an unbounded engine
// turn here would prevent Engine.Stop from ever cancelling that turn.
func TestTimerSchedulerStopDuringEngineRun(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		store, err := NewTimerStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		p := &timerBlockedPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"},
			entered: make(chan struct{}), release: make(chan struct{})}
		e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
		t.Cleanup(func() { _ = e.Stop() })
		sched := NewTimerScheduler(store)
		sched.RegisterEngine(e.name, e)
		noTimeout := 0
		job := &TimerJob{ID: "running", Project: e.name, SessionKey: "test:chat1",
			Prompt: "review report", ScheduledAt: time.Now(), TimeoutMins: &noTimeout}
		if err := sched.AddJob(job); err != nil {
			t.Fatal(err)
		}
		<-p.entered
		sched.Stop()
		close(p.release)
		synctest.Wait()
		if got := store.Get(job.ID); got == nil || got.Fired {
			t.Fatalf("interrupted job should remain pending for restart: %+v", got)
		}
	})
}

// Cancellation and replacement must release callback ownership too; otherwise
// Stop waits forever for an AfterFunc callback that will never be called.
func TestTimerSchedulerStopCancelsPending(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		store, err := NewTimerStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		sched := NewTimerScheduler(store)
		job := &TimerJob{ID: "pending", Project: "unregistered",
			SessionKey: "test:chat1", Prompt: "review report", ScheduledAt: time.Now().Add(time.Hour)}
		if err := sched.AddJob(job); err != nil {
			t.Fatal(err)
		}
		sched.scheduleAt(job, time.Hour)
		if !sched.RemoveJob(job.ID) {
			t.Fatal("pending job was not cancelled")
		}
		if err := sched.AddJob(job); err != nil {
			t.Fatal(err)
		}
		sched.Stop()
		sched.scheduleAt(job, 0) // a callback's late cooldown/quiet-period re-arm
		synctest.Wait()
		if got := store.Get(job.ID); got == nil || got.Fired {
			t.Fatalf("stopped timer fired instead of remaining pending: %+v", got)
		}
		late := *job
		late.ID = "after-stop"
		if err := sched.AddJob(&late); err == nil || store.Get(late.ID) != nil {
			t.Fatal("stopped scheduler accepted another store writer")
		}
		sched.Stop() // repeated cleanup must also finish
	})
}
