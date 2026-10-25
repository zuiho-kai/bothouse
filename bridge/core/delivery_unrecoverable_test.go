package core

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// unrecoverableProgressPlatform fails every card delivery with err and counts tries.
type unrecoverableProgressPlatform struct {
	*progressTestPlatform
	err   error
	tries int
	hook  func() // runs while a failing request is "in flight"
}

func (p *unrecoverableProgressPlatform) EnsureTaskCard(ctx context.Context, task *Task, lang Language) error {
	p.pm.Lock()
	p.tries++
	err, hook := p.err, p.hook
	p.pm.Unlock()
	if hook != nil {
		hook()
	}
	if err != nil {
		return err
	}
	return p.progressTestPlatform.EnsureTaskCard(ctx, task, lang)
}

func startProgressCard(t *testing.T, dir string, plat Platform) (*PublicProgress, string, string) {
	t.Helper()
	p, err := NewPublicProgress(dir, "fish", []Platform{plat})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(plat, "room:gone", LangChinese, nil)
	id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:gone", Run: run, Seq: 1, Kind: "start", Title: "t", Summary: "s"})
	if err != nil {
		t.Fatal(err)
	}
	return p, id, run
}

// A card whose channel Discord deleted (10003) is tried once, logged once and
// dropped from the retry queue, also across a restart.
func TestPublicProgressFlush_UnrecoverableDroppedOnce(t *testing.T) {
	buf, restore := captureSlog(t)
	defer restore()
	dir := t.TempDir()
	plat := &unrecoverableProgressPlatform{progressTestPlatform: newProgressPlatform(),
		err: fmt.Errorf("%w: HTTP 404 Not Found, {\"message\": \"Unknown Channel\", \"code\": 10003}", ErrDeliveryUnrecoverable)}
	p, _, run := startProgressCard(t, dir, plat)
	p.finish(run, "result") // closed: a restart appends no new fact
	for i := 0; i < 5; i++ {
		p.Flush(context.Background())
	}
	if plat.tries != 1 {
		t.Fatalf("tries = %d, want 1", plat.tries)
	}
	p.mu.Lock()
	pending := len(p.pending)
	p.mu.Unlock()
	if pending != 0 {
		t.Fatalf("pending = %d, want 0", pending)
	}
	logs := buf.String()
	if n := strings.Count(logs, "destination unrecoverable"); n != 1 {
		t.Fatalf("give-up lines = %d, want 1:\n%s", n, logs)
	}
	if strings.Contains(logs, "delivery pending") {
		t.Fatalf("unrecoverable error logged as pending:\n%s", logs)
	}
	restored, err := NewPublicProgress(dir, "fish", []Platform{plat})
	if err != nil {
		t.Fatal(err)
	}
	restored.Flush(context.Background())
	if plat.tries != 1 {
		t.Fatalf("restart retried a dropped delivery: tries = %d", plat.tries)
	}
}

// A temporary failure (network, 429, 5xx) stays queued and is retried.
func TestPublicProgressFlush_TemporaryStillRetried(t *testing.T) {
	plat := &unrecoverableProgressPlatform{progressTestPlatform: newProgressPlatform(), err: errors.New("HTTP 502 Bad Gateway")}
	p, id, _ := startProgressCard(t, t.TempDir(), plat)
	p.Flush(context.Background())
	p.Flush(context.Background())
	if plat.tries != 2 {
		t.Fatalf("tries = %d, want 2", plat.tries)
	}
	p.mu.Lock()
	_, queued := p.pending[id]
	p.mu.Unlock()
	if !queued {
		t.Fatal("temporary failure dropped from the queue")
	}
	plat.pm.Lock()
	plat.err = nil
	plat.pm.Unlock()
	p.Flush(context.Background())
	if plat.task(id) == nil {
		t.Fatal("card not delivered after the failure cleared")
	}
}

// The channel board stops retrying a send the platform refused for good, logs
// once, and tries again only after the channel changes.
func TestChannelBoard_UnrecoverableEditNotRetried(t *testing.T) {
	buf, restore := captureSlog(t)
	defer restore()
	h := newChannelBoardHub()
	p := newBoardPlatform()
	e := newBoardEngine(t, h, "maomao", p)
	e.SetChannelBoard(true)
	seq := h.beginTurn(e, "discord:c1", "活")
	waitBoard(t, "posted", func() bool { n, _, _ := p.counts(); return n == 1 })
	p.bmu.Lock()
	p.editErr = fmt.Errorf("discord: edit channel board: %w: 10003", ErrDeliveryUnrecoverable)
	p.bmu.Unlock()
	h.endTurn(e, "discord:c1", seq, BoardDoneCompleted)
	waitBoard(t, "edit tried", func() bool { p.bmu.Lock(); defer p.bmu.Unlock(); return p.editTries == 1 })
	time.Sleep(20 * p.interval) // several retry windows
	p.bmu.Lock()
	tries := p.editTries
	p.bmu.Unlock()
	if tries != 1 {
		t.Fatalf("edit tries = %d, want 1", tries)
	}
	if n := strings.Count(buf.String(), "destination unrecoverable"); n != 1 {
		t.Fatalf("give-up lines = %d, want 1:\n%s", n, buf.String())
	}
	h.beginTurn(e, "discord:c1", "新活") // newer activity: one more try
	waitBoard(t, "retried after new activity", func() bool { p.bmu.Lock(); defer p.bmu.Unlock(); return p.editTries == 2 })
}

// A fact accepted while the refused request was in flight is not marked
// handled with it: it stays pending and gets one try of its own.
func TestPublicProgressFlush_UnrecoverableKeepsFactAddedInFlight(t *testing.T) {
	plat := &unrecoverableProgressPlatform{progressTestPlatform: newProgressPlatform(),
		err: fmt.Errorf("%w: 10003", ErrDeliveryUnrecoverable)}
	p, id, run := startProgressCard(t, t.TempDir(), plat)
	plat.hook = func() {
		plat.hook = nil
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:gone", Run: run, TaskID: id, Seq: 2, Kind: "update", Summary: "in flight"}); err != nil {
			t.Error(err)
		}
	}
	p.Flush(context.Background())
	p.mu.Lock()
	_, queued := p.pending[id]
	r := p.records[id]
	p.mu.Unlock()
	r.mu.Lock()
	cardSeq, seq := r.record.CardSeq, r.record.Task.Seq
	r.mu.Unlock()
	if !queued || cardSeq != 1 || seq != 2 {
		t.Fatalf("queued=%v cardSeq=%d seq=%d, want queued, 1, 2", queued, cardSeq, seq)
	}
	p.Flush(context.Background())
	p.Flush(context.Background())
	p.mu.Lock()
	_, queued = p.pending[id]
	p.mu.Unlock()
	if plat.tries != 2 || queued {
		t.Fatalf("tries=%d queued=%v, want 2 tries then dropped", plat.tries, queued)
	}
}
