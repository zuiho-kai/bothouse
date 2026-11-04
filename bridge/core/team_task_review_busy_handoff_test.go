package core

import (
	"testing"
	"time"
)

// User 2026-11-04 23:2x「派活的角色忙超过 10 分钟，就转给空着的队友去验收」: a review queued in the
// reviewer's channel session moves to an idle teammate once the reviewer has been busy past the
// watch window; inside the window it stays put.
func TestTaskReviewBusyPastWindowMovesToIdle(t *testing.T) {
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead := reviewPickRole(t, "cjiang", "C酱", dir, ts, true)
	deep := reviewPickRole(t, "deep", "肥鱼", dir, ts, false)
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	writeReviewBoard(t, lead, teamTaskBoardItem{ID: 401, What: "a", Chat: "room:chat", Who: "工作区1G哥", Reviewer: "cjiang", ReturnedAt: now})
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead, deep} }

	// Lead idle: the review is queued in its channel session.
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 1 || jobs[0].Project != "cjiang" || jobs[0].UsesNewSessionPerRun() {
		t.Fatalf("idle lead: %+v", jobs)
	}

	// Lead turns busy.
	s := lead.sessions.GetOrCreateActive("room:chat")
	if !s.TryLock() {
		t.Fatal("lock")
	}
	defer s.Unlock()

	w.reconcileTaskReviews(jobs[0].ScheduledAt.Add(watchCheckAfter()/2), false)
	if got := store.List(); len(got) != 1 || got[0].Project != "cjiang" {
		t.Fatalf("inside the window the review must stay with the lead: %+v", got)
	}

	w.reconcileTaskReviews(jobs[0].ScheduledAt.Add(watchCheckAfter()+time.Minute), false)
	got := store.List()
	if len(got) != 1 || got[0].Project != "deep" {
		for _, j := range got { t.Logf("job %s %s fired=%v at=%v", j.ID[:16], j.Project, j.Fired, j.ScheduledAt) }; t.Fatalf("busy past the window: %d jobs; want deep", len(got))
	}
}
