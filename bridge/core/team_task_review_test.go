package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeReviewBoard(t *testing.T, e *Engine, items ...teamTaskBoardItem) {
	t.Helper()
	var data []byte
	for _, it := range items {
		b, err := json.Marshal(it)
		if err != nil {
			t.Fatal(err)
		}
		data = append(data, b...)
		data = append(data, '\n')
	}
	if err := os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardFile), data, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestTaskReviewPersistenceAndRouting(t *testing.T) {
	e := NewEngine("worker", &stubAgent{}, nil, "", LangChinese)
	lead := NewEngine("dispatcher", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(func() { e.cancel(); lead.cancel() })
	dir := t.TempDir()
	e.SetTeam(dir, "worker", false)
	lead.SetTeam(dir, "派活人", true)
	data := t.TempDir()
	store, err := NewTimerStore(data)
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead.SetTimerScheduler(ts)
	// Keep actual scheduling in the future; drive the existing watch with a controlled clock.
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 46, What: "verify", Chat: "room:chat", Reviewer: "dispatcher", ReturnedAt: now.Add(-30 * time.Minute)}
	writeReviewBoard(t, e, it)
	w := newHandoffWatch(e)
	w.engines = func() []*Engine { return []*Engine{e, lead} }
	w.reconcileTaskReviews(now, false)
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 1 || jobs[0].Project != "dispatcher" || jobs[0].SessionKey != "room:chat" {
		t.Fatalf("wrong routing or duplicate: %+v", jobs)
	}
	if !strings.Contains(jobs[0].Prompt, "board reject 46") {
		t.Fatal(jobs[0].Prompt)
	}
	// Persisted timers, not process memory, deduplicate after a bridge restart.
	ts.Stop()
	reloaded, err := NewTimerStore(data)
	if err != nil {
		t.Fatal(err)
	}
	ts2 := NewTimerScheduler(reloaded)
	defer ts2.Stop()
	lead.SetTimerScheduler(ts2)
	w.reconcileTaskReviews(now, false)
	if len(reloaded.List()) != 1 {
		t.Fatal("restart duplicated initial reminder")
	}
	w.reconcileTaskReviews(now.Add(30*time.Minute), false)
	w.reconcileTaskReviews(now.Add(31*time.Minute), false)
	if len(reloaded.List()) != 2 {
		t.Fatal("overdue reminder must be exactly once")
	}
	for _, job := range reloaded.List() {
		reloaded.MarkFired(job.ID, nil)
	}
	w.reconcileTaskReviews(now.Add(time.Hour), true)
	w.reconcileTaskReviews(now.Add(time.Hour), true)
	if len(reloaded.List()) != 3 {
		t.Fatal("hourly fallback must be once per hour")
	}
	ref := jobs[0].TaskReview
	if !lead.taskReviewPending(ref) {
		t.Fatal("pending handback lost")
	}
	writeReviewBoard(t, e)
	if lead.taskReviewPending(ref) {
		t.Fatal("accepted task still pending")
	}
	if err := lead.ExecuteTimerJob(jobs[0]); err != nil {
		t.Fatalf("obsolete job should be skipped before platform lookup: %v", err)
	}
	it.ReturnedAt = now
	writeReviewBoard(t, e, it)
	if lead.taskReviewPending(ref) {
		t.Fatal("old reminder reused after rework")
	}
}

func TestTaskReviewTableDeadline(t *testing.T) {
	now := time.Now()
	it := teamTaskBoardItem{ID: 46, What: "核对交回", Chat: "room:main", own: "room:main", Reviewer: "lead", reviewerName: "派活人", ReturnedAt: now.Add(-time.Hour)}
	table := renderTeamTaskTable([]teamTaskBoardItem{it}, nil, "room:main", now)
	if !strings.Contains(table, "⚠") || !strings.Contains(table, "没人验收 · 等派活人") {
		t.Fatal(table)
	}
	it.reviewAfter = 2 * time.Hour
	table = renderTeamTaskTable([]teamTaskBoardItem{it}, nil, "room:main", now)
	if !strings.Contains(table, "🟡") || strings.Contains(table, "没人验收") {
		t.Fatal(table)
	}
	if watchBoardClosed(it) {
		t.Fatal("handback is not closed")
	}
	it.Status = "已交回待验收"
	if watchBoardClosed(it) {
		t.Fatal("handback status is not acceptance")
	}
}

func TestRegression797ReleasedWorkspaceIsPaused(t *testing.T) {
	it := teamTaskBoardItem{ID: 42, What: "七件未完成", WS: "room:ws", Chat: "room:main", own: "room:ws", parent: "room:main", wsName: "工作区1", wsEnded: true}
	state, _ := teamTaskBoardStateOf(it, time.Now())
	if state != teamTaskPaused {
		t.Fatalf("released unfinished task state=%v, want paused", state)
	}
	if got := renderTeamTaskTable([]teamTaskBoardItem{it}, nil, "room:main", time.Now()); strings.Contains(got, "🟡") || !strings.Contains(got, "暂停") {
		t.Fatal(got)
	}
}

func TestTaskReviewRecoversDeliveredReceiptOnly(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	e.productPyBin.Store(t.TempDir())
	gate, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gate, filepath.Join(e.dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 1, What: "delivered", Chat: "room:chat", Dispatcher: "lead"},
		teamTaskBoardItem{ID: 2, What: "released", Chat: "room:chat", WS: "room:ws"},
		teamTaskBoardItem{ID: 3, What: "rejected", Chat: "room:chat", ReviewRejected: "missing test"},
	)
	e.markExitReported(1)
	e.markExitReported(3)
	newHandoffWatch(e).reconcileTaskReviews(time.Now(), false)
	items := readTeamTaskBoard(e.team.dir)
	if len(items) != 3 || items[0].ReturnedAt.IsZero() || !items[1].ReturnedAt.IsZero() || !items[2].ReturnedAt.IsZero() {
		t.Fatalf("receipt recovery confused release/rejection with report: %+v", items)
	}
}

func TestTaskReviewRoundupFiltersAcceptedAndCoalescesRestart(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetTeam(t.TempDir(), "lead", true)
	store, _ := NewTimerStore(t.TempDir())
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	e.SetTimerScheduler(ts)
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	a := teamTaskBoardItem{ID: 1, What: "first", Chat: "room:main", Reviewer: "lead", ReturnedAt: now.Add(-2 * time.Hour)}
	b := a
	b.ID = 2
	b.What = "second"
	writeReviewBoard(t, e, a, b)
	w := newHandoffWatch(e)
	w.reconcileTaskReviews(now, true)
	jobs := store.List()
	if len(jobs) != 2 {
		t.Fatalf("one overdue reminder per item, no startup burst: %d", len(jobs))
	}
	for _, j := range jobs {
		if j.TaskReview.Stage != "overdue" {
			t.Fatalf("unexpected catchup stage: %+v", j)
		}
		store.MarkFired(j.ID, nil)
	}
	later := now.Add(time.Hour)
	w.reconcileTaskReviews(later, true)
	w.reconcileTaskReviews(later, true)
	var summary *TimerJob
	for _, j := range store.List() {
		if j.TaskReview.Stage == "roundup" {
			summary = j
		}
	}
	if len(store.List()) != 3 || summary == nil || len(summary.TaskReview.Items) != 2 {
		t.Fatalf("not one grouped roundup: %+v", store.List())
	}
	writeReviewBoard(t, e, b)
	prepared, err := e.prepareTaskReview(summary, later)
	if err != nil || prepared == nil || strings.Contains(prepared.Prompt, "first") || !strings.Contains(prepared.Prompt, "second") {
		t.Fatalf("obsolete summary entries retained: %+v %v", prepared, err)
	}
	if prepared, err = e.prepareTaskReview(summary, later.Add(time.Hour)); err != nil || prepared != nil {
		t.Fatal("expired summary replays after restart")
	}
	writeReviewBoard(t, e)
	if prepared, err = e.prepareTaskReview(summary, later); err != nil || prepared != nil {
		t.Fatal("accepted summary still wakes role")
	}
	state := &interactiveState{pendingMessages: []queuedMessage{{content: "review", timerJobID: summary.ID}, {content: "human"}}}
	e.refreshQueuedTaskReviewsLocked(state)
	if len(state.pendingMessages) != 1 || state.pendingMessages[0].content != "human" {
		t.Fatalf("queued stale review survived: %+v", state.pendingMessages)
	}
}

func TestTaskReviewUnavailableEscalatesWithoutChangingOwner(t *testing.T) {
	e := NewEngine("primary", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetTeam(t.TempDir(), "primary", true)
	store, _ := NewTimerStore(t.TempDir())
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	e.SetTimerScheduler(ts)
	now := time.Now().Add(24 * time.Hour)
	it := teamTaskBoardItem{ID: 46, Chat: "room:main", Reviewer: "missing", ReturnedAt: now}
	writeReviewBoard(t, e, it)
	w := newHandoffWatch(e)
	w.reconcileTaskReviews(now, false)
	w.reconcileTaskReviews(now, false)
	jobs := store.List()
	if len(jobs) != 1 || jobs[0].Project != "primary" || !strings.Contains(jobs[0].Prompt, "missing") {
		t.Fatalf("missing dispatcher left unattended: %+v", jobs)
	}
	if e.boardItemByID(46).Reviewer != "missing" {
		t.Fatal("original owner lost")
	}
	recovered := NewEngine("missing", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(recovered.cancel)
	recovered.SetTeam(e.team.dir, "missing", false)
	recovered.SetTimerScheduler(ts)
	w.engines = func() []*Engine { return []*Engine{e, recovered} }
	w.reconcileTaskReviews(now, false)
	if len(store.List()) != 2 {
		t.Fatal("recovered dispatcher not notified")
	}
}

func TestTaskReviewPendingBoardAndRejectedVisibility(t *testing.T) {
	now := time.Now()
	it := teamTaskBoardItem{ID: 46, What: "review", own: "room:main", ReturnedAt: now, wsEnded: true}
	if !teamTaskBoardLive([]teamTaskBoardItem{it}, "room:main") {
		t.Fatal("cloud-web would mark pending verification completed")
	}
	it.ReturnedAt = time.Time{}
	it.wsEnded = false
	it.Paused = "now"
	it.ReviewRejected = "missing test"
	it.PauseWhy = "验收退回：missing test"
	got := renderTeamTaskTable([]teamTaskBoardItem{it}, nil, "room:main", now)
	if !strings.Contains(got, "missing test") || !strings.Contains(got, "暂停") {
		t.Fatal(got)
	}
}

func TestTaskReviewUsesBundledCommandsWithOldInstallation(t *testing.T) {
	old := LeadToolFS
	LeadToolFS = os.DirFS("..")
	t.Cleanup(func() { LeadToolFS = old })
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	oldDir := filepath.Join(e.dataDir, "collaboration", "lead")
	if err := os.MkdirAll(oldDir, 0755); err != nil {
		t.Fatal(err)
	}
	oldScript := []byte("#!/bin/sh\nexit 99\n")
	if err := os.WriteFile(filepath.Join(oldDir, "board"), oldScript, 0755); err != nil {
		t.Fatal(err)
	}
	writeReviewBoard(t, e, teamTaskBoardItem{ID: 46, Chat: "room:main", Dispatcher: "lead"})
	if out, err := e.runLeadScript("room:main", "board", "returned", "46", "lead"); err != nil {
		t.Fatalf("old installed board blocked handback: %v %s", err, out)
	}
	if e.boardItemByID(46).ReturnedAt.IsZero() {
		t.Fatal("return not persisted")
	}
	got, _ := os.ReadFile(filepath.Join(oldDir, "board"))
	if string(got) != string(oldScript) {
		t.Fatal("customized installed command overwritten")
	}
	root, err := e.leadRuntimeDir()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "lead", "ws-handoff")); err != nil {
		t.Fatal("current resume command missing", err)
	}
}

func TestTaskReviewWriteFailureReleasesWorkspaceAndReceiptRecovers(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	e.productPyBin.Store(t.TempDir())
	if err := e.ClaimTeamWorkspaceFor("room:main", "ws1", "工作区1", "worker", "verify"); err != nil {
		t.Fatal(err)
	}
	old := e.sessions.GetOrCreateActive("room:ws1")
	writeReviewBoard(t, e, teamTaskBoardItem{ID: 46, What: "verify", Chat: "room:main", WS: "room:ws1", Dispatcher: "lead"})
	e.markExitReported(46)
	// No installed scripts: the delivered final report must still end the execution session.
	e.endWorkspaceTask("room:main", "room:ws1", exitKindReport, 46)
	if e.sessions.ActiveSessionID("room:ws1") == old.ID {
		t.Fatal("board write failure kept the old workspace session")
	}
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("board write failure kept the workspace owned")
	}
	gate, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gate, filepath.Join(e.dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	newHandoffWatch(e).reconcileTaskReviews(time.Now(), false)
	if it := e.boardItemByID(46); it == nil || it.ReturnedAt.IsZero() {
		t.Fatal("delivered receipt failed to recover after script repair")
	}
}
