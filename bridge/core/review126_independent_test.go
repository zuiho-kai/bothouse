package core

// Independent acceptance cases written by G哥 for #126 (review126-pr967.md), kept as regressions.

import (
	"testing"
	"time"
)

// Independent acceptance: a role that cannot reply on the originating platform
// must never capture a review ahead of an available role on that platform.
func TestReview126SkipsWrongPlatform(t *testing.T) {
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	author := reviewPickRole(t, "author", "作者", dir, ts, true)
	wrong := reviewPickRole(t, "aaa", "异平台角色", dir, ts, false)
	right := reviewPickRole(t, "zzz", "同平台角色", dir, ts, false)
	wrong.platforms = []Platform{&stubPlatformEngine{n: "qq"}}
	right.platforms = []Platform{&stubPlatformEngine{n: "discord"}}
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 1, What: "验收", Chat: "discord:chat", Who: "作者", Reviewer: "author", ReturnedAt: now}
	writeReviewBoard(t, author, it)
	w := newHandoffWatch(author)
	w.engines = func() []*Engine { return []*Engine{author, wrong, right} }
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 1 {
		t.Fatalf("jobs=%d", len(jobs))
	}
	if jobs[0].Project != right.name {
		picked := wrong
		failure := picked.ExecuteTimerJob(jobs[0])
		t.Fatalf("review assigned to %s instead of platform-capable %s; actual timer error: %v", jobs[0].Project, right.name, failure)
	}
}

// Independent acceptance: reserving an idle session for the first review must
// make subsequent reviews use fresh conversations rather than queue behind it.
func TestReview126BatchReservesReviewerSession(t *testing.T) {
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	author := reviewPickRole(t, "author", "作者", dir, ts, true)
	reviewer := reviewPickRole(t, "reviewer", "审者", dir, ts, false)
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	a := teamTaskBoardItem{ID: 1, What: "甲", Chat: "discord:chat", Who: "作者", Reviewer: "author", ReturnedAt: now}
	b := a
	b.ID, b.What = 2, "乙"
	writeReviewBoard(t, author, a, b)
	w := newHandoffWatch(author)
	w.engines = func() []*Engine { return []*Engine{author, reviewer} }
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	regular := 0
	for _, job := range jobs {
		if !job.UsesNewSessionPerRun() {
			regular++
		}
	}
	if len(jobs) != 2 || regular > 1 {
		t.Fatalf("batch jobs=%d, jobs sharing the same normal session=%d; want at most one and remaining reviews in fresh sessions", len(jobs), regular)
	}
}
