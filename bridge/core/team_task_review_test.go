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
