package core

// Independent acceptance case written by G哥 for #126 (review126-pr969.md), kept as a regression.

import (
	"testing"
	"time"
)

func TestReview126EscalationInvalidatesQueuedSimpleReview(t *testing.T) {
	SetTeamReviewTiers("simple", "complex")
	t.Cleanup(func() { SetTeamReviewTiers("", "") })
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	author := reviewPickRole(t, "author", "作者", dir, ts, true)
	simple := reviewPickRole(t, "simple", "简单审者", dir, ts, false)
	complex := reviewPickRole(t, "complex", "复杂审者", dir, ts, false)
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 1, What: "验收", Chat: "discord:chat", Who: "作者", Reviewer: "author", ReturnedAt: now}
	writeReviewBoard(t, author, it)
	w := newHandoffWatch(author)
	w.engines = func() []*Engine { return []*Engine{author, simple, complex} }
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 1 {
		t.Fatalf("initial jobs=%d", len(jobs))
	}
	old := jobs[0]
	it.ReviewTier = "complex"
	writeReviewBoard(t, author, it)
	w.reconcileTaskReviews(now, false)
	prepared, err := simple.prepareTaskReview(old, now)
	if err != nil {
		t.Fatal(err)
	}
	if prepared != nil {
		t.Fatalf("queued simple review remains executable after escalation; stored jobs=%d, old project=%s, task=%d", len(store.List()), prepared.Project, prepared.ReplyBoard)
	}
}
