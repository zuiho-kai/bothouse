package core

import (
	"strings"
	"testing"
	"time"
)

// reviewTestPlatforms: the platforms the review tests' chats run on ("room:…", "discord:…"); a
// role must be able to reply on the handback's platform to be picked.
func reviewTestPlatforms() []Platform {
	return []Platform{&stubPlatformEngine{n: "room"}, &stubPlatformEngine{n: "discord"}}
}

func reviewPickRole(t *testing.T, name, team, dir string, ts *TimerScheduler, lead bool) *Engine {
	t.Helper()
	x := NewEngine(name, &stubAgent{}, reviewTestPlatforms(), "", LangChinese)
	t.Cleanup(x.cancel)
	x.dataDir = t.TempDir()
	x.SetTeam(dir, team, lead)
	x.SetTimerScheduler(ts)
	return x
}

// User 2026-11-04 10:4x: reviews are handed out, never to the author, never to a cooling role,
// a batch spreads over roles, and a busy role reviews in a new conversation.
func TestTaskReviewAutoPick(t *testing.T) {
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead := reviewPickRole(t, "cjiang", "C酱", dir, ts, true)
	gge := reviewPickRole(t, "gge", "G哥", dir, ts, false)
	deep := reviewPickRole(t, "deep", "肥鱼", dir, ts, false)
	engines := []*Engine{lead, gge, deep}
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	// 112-like: the author is the lead's workspace; the designated reviewer is that same lead.
	a := teamTaskBoardItem{ID: 201, What: "a", Chat: "room:chat", Who: "工作区1C酱", Reviewer: "cjiang", ReturnedAt: now}
	b := teamTaskBoardItem{ID: 202, What: "b", Chat: "room:chat", Who: "工作区2C酱", Reviewer: "cjiang", ReturnedAt: now}
	writeReviewBoard(t, lead, a, b)
	deep.recordQuota(now.Add(624*time.Hour), "room:chat") // deep cools
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return engines }
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 2 {
		t.Fatalf("jobs = %d, want one per handback", len(jobs))
	}
	for _, j := range jobs {
		if j.Project != "gge" {
			t.Fatalf("board %d went to %s; want gge (cjiang is the author, deep is cooling)", j.ReplyBoard, j.Project)
		}
	}
	// A second scan keeps the queued reviewer instead of re-picking.
	w.reconcileTaskReviews(now, false)
	if n := len(store.List()); n != 2 {
		t.Fatalf("rescan duplicated reviews: %d jobs", n)
	}

	// The picked role starts cooling before its job ran: the review moves to another role.
	for _, j := range store.List() {
		store.Remove(j.ID)
	}
	grok := reviewPickRole(t, "grok", "大豆包", dir, ts, false) // not cooling
	engines = []*Engine{lead, gge, deep, grok}
	c := teamTaskBoardItem{ID: 203, What: "c", Chat: "room:chat", Who: "工作区3C酱", Reviewer: "cjiang", ReturnedAt: now}
	writeReviewBoard(t, lead, c)
	w.reconcileTaskReviews(now, false)
	first := store.List()
	if len(first) != 1 {
		t.Fatalf("jobs = %+v", first)
	}
	picked := map[string]*Engine{"gge": gge, "grok": grok}[first[0].Project]
	picked.recordQuota(now.Add(time.Hour), "room:chat")
	w.reconcileTaskReviews(now, false)
	after := store.List()
	if len(after) != 1 || after[0].Project == first[0].Project {
		t.Fatalf("cooling reviewer kept the review: before %s, after %+v", first[0].Project, after)
	}
}

// Every candidate is busy: the review still goes out at once, in a new side conversation of
// the role, instead of queueing behind its running work (user:「开新肥鱼 新对话来审核」).
func TestTaskReviewAutoPickBusyUsesFreshSession(t *testing.T) {
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead := reviewPickRole(t, "cjiang", "C酱", dir, ts, true)
	deep := reviewPickRole(t, "deep", "肥鱼", dir, ts, false)
	s := deep.sessions.GetOrCreateActive("room:chat")
	if !s.TryLock() {
		t.Fatal("lock")
	}
	defer s.Unlock()
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	writeReviewBoard(t, lead, teamTaskBoardItem{ID: 301, What: "a", Chat: "room:chat", Who: "工作区1C酱", Reviewer: "cjiang", ReturnedAt: now})
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead, deep} }
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 1 || jobs[0].Project != "deep" || !jobs[0].UsesNewSessionPerRun() {
		t.Fatalf("busy reviewer: %+v; want deep in a new session", jobs)
	}
}

// The channel session turns busy between queueing and running: the review moves to a side
// session at run time; the hourly roundup stays in the channel session.
func TestTaskReviewBusyAtRunUsesFreshSession(t *testing.T) {
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	deep := reviewPickRole(t, "deep", "肥鱼", dir, ts, false)
	job := &TimerJob{ID: "r", Project: "deep", SessionKey: "room:chat", TaskReview: &taskReviewRef{Board: 1, Stage: "returned"}}
	if got := deep.taskReviewSessionAtRun(job); got.UsesNewSessionPerRun() {
		t.Fatal("idle session: review should stay in the channel session")
	}
	s := deep.sessions.GetOrCreateActive("room:chat")
	if !s.TryLock() {
		t.Fatal("lock")
	}
	defer s.Unlock()
	if got := deep.taskReviewSessionAtRun(job); !got.UsesNewSessionPerRun() || job.UsesNewSessionPerRun() {
		t.Fatalf("busy at run: fresh=%v, original mutated=%v", got.UsesNewSessionPerRun(), job.UsesNewSessionPerRun())
	}
	roundup := &TimerJob{ID: "u", Project: "deep", SessionKey: "room:chat", TaskReview: &taskReviewRef{Stage: "roundup"}}
	if deep.taskReviewSessionAtRun(roundup).UsesNewSessionPerRun() {
		t.Fatal("roundup moved out of the channel session")
	}
}

// [team_review] picks the role per tier: unmarked goes to the simple (cheap) role; board tier
// complex queues a second verification with the complex role (主角色代答 A+C, 2026-11-04).
func TestTaskReviewTierRoles(t *testing.T) {
	SetTeamReviewTiers("deep", "gge")
	t.Cleanup(func() { SetTeamReviewTiers("", "") })
	dir := t.TempDir()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead := reviewPickRole(t, "cjiang", "C酱", dir, ts, true)
	gge := reviewPickRole(t, "gge", "G哥", dir, ts, false)
	deep := reviewPickRole(t, "deep", "肥鱼", dir, ts, false)
	grok := reviewPickRole(t, "grok", "大豆包", dir, ts, false)
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 401, What: "a", Chat: "room:chat", Who: "工作区1C酱", Reviewer: "cjiang", ReturnedAt: now}
	writeReviewBoard(t, lead, it)
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead, grok, gge, deep} }
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 1 || jobs[0].Project != "deep" {
		t.Fatalf("unmarked handback: %+v; want the simple-tier role deep", jobs)
	}
	if !strings.Contains(jobs[0].Prompt, "board tier 401 complex") && !strings.Contains(jobs[0].Prompt, "tier 401 complex") {
		t.Fatalf("simple review does not say how to escalate: %s", jobs[0].Prompt)
	}
	store.MarkFired(jobs[0].ID, nil)
	it.ReviewTier = "complex"
	writeReviewBoard(t, lead, it)
	w.reconcileTaskReviews(now, false)
	var complexJobs []*TimerJob
	for _, j := range store.List() {
		if !j.Fired {
			complexJobs = append(complexJobs, j)
		}
	}
	if len(complexJobs) != 1 || complexJobs[0].Project != "gge" {
		t.Fatalf("escalated handback: %+v; want one new review by gge", complexJobs)
	}
}
