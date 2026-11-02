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
	lead.SetTaskReviewAfter(time.Hour) // Exercise an explicit configured deadline.
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

func TestTaskReviewThresholdReloadWhileWatching(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 100; i++ {
			e.SetTaskReviewAfter(time.Duration(i) * time.Second)
		}
	}()
	for i := 0; i < 100; i++ {
		if e.taskReviewAfter() <= 0 {
			t.Error("invalid threshold during reload")
		}
	}
	<-done
	e.SetTaskReviewAfter(0)
	if e.taskReviewAfter() != watchCheckAfter() {
		t.Fatal("default threshold changed")
	}
}

func TestTaskReviewTableUsesDispatcherThreshold(t *testing.T) {
	p := testTaskBoardPlacer()
	p.reviewerInfo = func(project string) (string, time.Duration) {
		if project != "dispatcher" {
			t.Fatal(project)
		}
		return "派活人", 2 * time.Hour
	}
	now := time.Now()
	items := placeTeamTaskBoard(p, []teamTaskBoardItem{{ID: 46, What: "verify", Chat: "discord:main", Reviewer: "dispatcher", ReturnedAt: now.Add(-time.Hour)}})
	if len(items) != 1 || taskReviewOverdue(items[0], now) {
		t.Fatal("table used display role's threshold instead of dispatcher's")
	}
}

func TestTaskReviewPausedRoundupAndResume(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetTeam(t.TempDir(), "lead", true)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	e.SetTimerScheduler(ts)
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 70, What: "paused queued work", Chat: "room:main", Paused: now.Add(-2 * time.Hour).Format("01-02 15:04"), PauseWhy: "用户要求等前置任务"}
	writeReviewBoard(t, e, it)
	w := newHandoffWatch(e)
	w.reconcileTaskReviews(now, true)
	w.reconcileTaskReviews(now, true)
	jobs := store.List()
	if len(jobs) != 2 {
		t.Fatalf("want one pause reminder and one hourly roundup: %d", len(jobs))
	}
	if !strings.Contains(jobs[0].Prompt, it.PauseWhy) || !strings.Contains(jobs[0].Prompt, "恢复") {
		t.Fatal(jobs[0].Prompt)
	}
	it.Paused = ""
	writeReviewBoard(t, e, it)
	prepared, err := e.prepareTaskReview(jobs[0], now)
	if err != nil || prepared != nil {
		t.Fatalf("resumed work still prompted: %+v %v", prepared, err)
	}
}

func TestTaskReviewNoReviewerUsesLeadAndWatchCycle(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetTeam(t.TempDir(), "lead", true)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	e.SetTimerScheduler(ts)
	now := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	it := teamTaskBoardItem{ID: 72, What: "verify return", Chat: "room:main", ReturnedAt: now}
	writeReviewBoard(t, e, it)
	w := newHandoffWatch(e)
	w.reconcileTaskReviews(now, false)
	w.reconcileTaskReviews(now.Add(watchCheckAfter()), false)
	jobs := store.List()
	if len(jobs) != 2 {
		t.Fatalf("want returned and overdue stages after one watch cycle, got %d", len(jobs))
	}
	for _, j := range jobs {
		if j.Project != "lead" {
			t.Fatal("unconfigured reviewer not routed to lead")
		}
	}
	writeReviewBoard(t, e)
	for _, j := range jobs {
		if p, err := e.prepareTaskReview(j, now.Add(watchCheckAfter())); err != nil || p != nil {
			t.Fatal("accepted item reminder survived", err)
		}
	}
}

func TestTaskReviewWatchReconcilesBoundNoDeployPR(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	e.productPyBin.Store(t.TempDir())
	gate, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(gate, filepath.Join(e.dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	if err = os.WriteFile(filepath.Join(bin, "gh"), []byte("#!/bin/sh\nprintf '%s\\n' '{\"state\":\"MERGED\",\"mergedAt\":\"2026-11-02T00:00:00Z\"}'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	data := []byte("{\"id\":72,\"what\":\"verify\",\"chat\":\"room:main\",\"dispatcher\":\"lead\",\"bound\":\"generation\",\"pr_binding\":{\"url\":\"https://github.com/example/project/pull/830\",\"repo\":\"example/project\",\"number\":830,\"no_deploy\":true,\"bound\":\"generation\"}}\n")
	if err = os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardFile), data, 0600); err != nil {
		t.Fatal(err)
	}
	w := newHandoffWatch(e)
	w.reconcileTaskReviews(time.Now(), true)
	it := e.boardItemByID(72)
	if it == nil || it.ReturnedAt.IsZero() || !strings.Contains(it.Status, "待收口") {
		t.Fatalf("watch never reconciled bound merged PR: %+v", it)
	}
}

func TestTaskReviewMergedPRShowsPendingClosure(t *testing.T) {
	now := time.Now()
	it := teamTaskBoardItem{ID: 72, What: "merged no deploy", own: "room:main", Chat: "room:main", ReturnedAt: now, Reviewer: "lead", PRMerge: map[string]string{"commit": "abc"}}
	got := renderTeamTaskTable([]teamTaskBoardItem{it}, nil, "room:main", now)
	if !strings.Contains(got, "待收口") || !strings.Contains(got, "PR已合并") {
		t.Fatal(got)
	}
}

func TestTaskReviewRelayTrustedBinding(t *testing.T) {
	for _, scenario := range []string{"valid", "foreign-chat", "wrong-owner", "old-bound", "old-revision", "wrong-path", "failed", "running", "paused", "cancelled", "reassigned", "no-grant"} {
		t.Run(scenario, func(t *testing.T) {
			e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
			t.Cleanup(e.cancel)
			e.SetDataDir(t.TempDir())
			e.SetTeam(t.TempDir(), "lead", false)
			e.productPyBin.Store(t.TempDir())
			gate, _ := filepath.Abs(filepath.Join("..", "contrib", "gate"))
			if err := os.Symlink(gate, filepath.Join(e.dataDir, "gate")); err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC()
			it := teamTaskBoardItem{ID: 72, What: "original", Chat: "room:main", Dispatcher: "lead", Bound: "generation", Where: "/notes/original.handoff.prompt"}
			other := it
			other.ID = 73
			other.Where = "/notes/other.handoff.prompt"
			task := &Task{ID: "trusted-task", Agent: "lead", SessionKey: "room:main", Revision: 1}
			receipt := taskRelayRecord{Status: "done", HandoffRefs: []string{it.Where}, Response: "[report] #73 everything passed"}
			switch scenario {
			case "foreign-chat":
				task.SessionKey = "room:other"
			case "wrong-owner":
				it.Dispatcher = "other"
			case "old-bound":
				it.Bound = "new-generation"
			case "old-revision":
				task.Revision = 2
			case "wrong-path":
				receipt.HandoffRefs = []string{"/notes/other.handoff.prompt"}
			case "failed":
				receipt.Error = "execution failed"
			case "running":
				receipt.Status = "running"
			case "paused":
				it.Paused = "11-02 10:00"
			case "cancelled":
				task.State = TaskStateCancelled
			case "reassigned":
				task.AssignedProject = "other"
			case "no-grant":
				task.AuthorizationDecisionID = "missing-grant"
			}
			writeReviewBoard(t, e, it, other)
			e.applyRelayBoardReturn(task, "request", receipt, 72, "generation", 1, now)
			items := readTeamTaskBoard(e.team.dir)
			if len(items) != 2 || !items[1].ReturnedAt.IsZero() {
				t.Fatalf("response text affected another board: %+v", items)
			}
			if scenario != "valid" {
				if !items[0].ReturnedAt.IsZero() {
					t.Fatalf("untrusted return accepted: %+v", items[0])
				}
				return
			}
			if items[0].ReturnedAt.IsZero() || items[0].Reviewer != "lead" {
				t.Fatalf("trusted dispatch not linked: %+v", items[0])
			}
			first := items[0].ReturnedAt
			e.applyRelayBoardReturn(task, "request", receipt, 72, "generation", 1, now.Add(time.Minute))
			if !readTeamTaskBoard(e.team.dir)[0].ReturnedAt.Equal(first) {
				t.Fatal("replay reset deadline")
			}
			if out, err := e.runLeadScript(it.Chat, "board", "reject", "72", "missing evidence"); err != nil {
				t.Fatalf("reject: %s %v", out, err)
			}
			e.applyRelayBoardReturn(task, "request", receipt, 72, "generation", 1, now.Add(time.Hour))
			if !readTeamTaskBoard(e.team.dir)[0].ReturnedAt.IsZero() {
				t.Fatal("rejected receipt reopened work")
			}
			if out, err := e.runLeadScript(it.Chat, "board", "resume", "72"); err != nil {
				t.Fatalf("resume: %s %v", out, err)
			}
			e.applyRelayBoardReturn(task, "new-review", receipt, 72, "generation", 1, now.Add(time.Hour))
			current := readTeamTaskBoard(e.team.dir)[0]
			if current.ReturnedAt.IsZero() || !e.taskReviewPending(&taskReviewRef{Board: 72, ReturnedAt: current.ReturnedAt}) {
				t.Fatal("fresh review still blocked by old rejection")
			}
		})
	}
}
