package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestTaskBatchesExplicitContinuationRebindsRun(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	stopped := false
	run := p.begin(platform, "room", LangEnglish, func() bool { return stopped })
	grant, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, BatchID: "A", MemberID: "worker", Name: "Worker", Title: "Work"})
	if err != nil {
		t.Fatal(err)
	}
	for seq := int64(1); seq <= 64; seq++ {
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, TaskID: grant.TaskID, Seq: seq, Kind: "update", Summary: "working"}); err != nil {
			t.Fatal(err)
		}
	}
	p.finish(run, "result")
	stopped = true
	next := p.begin(platform, "room", LangEnglish, nil)
	continued, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: next, TaskID: grant.TaskID, MemberID: "reviewer", Name: "Reviewer", Title: "Review"})
	if err != nil || continued.TaskID != grant.TaskID || continued.LeadNextSeq != 65 {
		t.Fatalf("explicit continuation: %v", err)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: next, TaskID: grant.TaskID, Seq: 65, Kind: "update", Summary: "continued"}); err != nil {
		t.Fatal("new turn inherited old stop callback or exhausted budget:", err)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: progressToken(t, grant.ReportCommand), Seq: 1, Kind: "update", Summary: "still working"}); err != nil {
		t.Fatal("member inherited old stop callback:", err)
	}
	if task, _ := p.Task(grant.TaskID); len(task.Members) != 2 || task.State != TaskStateInProgress {
		t.Fatal("continuation lost members or state")
	}
}

// A batch card released by an earlier lead turn must stay closable by a later
// lead turn via --task, otherwise it stays listed as running forever.
func TestTaskBatchesLaterLeadTurnClosesReleasedCard(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room", LangEnglish, nil)
	grant, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, BatchID: "A", MemberID: "w", Name: "W", Title: "Work"})
	if err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	member := progressToken(t, grant.ReportCommand)
	for seq, kind := range []string{"update", "result"} {
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: member, Seq: int64(seq + 1), Kind: kind, Summary: kind}); err != nil {
			t.Fatal(err)
		}
	}
	other := p.begin(platform, "elsewhere", LangEnglish, nil)
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "elsewhere", Run: other, TaskID: grant.TaskID, Seq: 1, Kind: "result", Summary: "x"}); err == nil {
		t.Fatal("another session closed the card")
	}
	next := p.begin(platform, "room", LangEnglish, nil)
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: next, TaskID: grant.TaskID, Seq: 1, Kind: "result", Summary: "all done"}); err != nil {
		t.Fatal("later lead turn cannot close released batch card:", err)
	}
	p.finish(next, "result")
	task, _ := p.Task(grant.TaskID)
	p.mu.Lock()
	_, listed := p.listed[grant.TaskID]
	p.mu.Unlock()
	if task.State != TaskStateResultReady || listed {
		t.Fatalf("state=%s listed=%v, want result_ready and unlisted", task.State, listed)
	}
}

// Assigning a member to the resume candidate by id before the first lead report
// must keep the RESUME_NOTE sequence usable for the lead's own progress.
func TestTaskBatchesAssignByIDKeepsResumeSequence(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room", LangEnglish, nil)
	id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "T", Summary: "s"})
	if err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	next := p.begin(platform, "room", LangEnglish, nil)
	cid, seq, ok := p.runStart(next)
	if !ok || cid != id {
		t.Fatalf("resume candidate %s %v, want %s", cid, ok, id)
	}
	if _, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: next, TaskID: cid, MemberID: "w", Name: "W", Title: "Work"}); err != nil {
		t.Fatal("assign:", err)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: next, Seq: seq, Kind: "update", Summary: "continue"}); err != nil {
		t.Fatal("RESUME_NOTE report after assign --id:", err)
	}
	p.finish(next, "result")
	if task, _ := p.Task(id); task.State != TaskStateResultReady {
		t.Fatalf("state=%s, want result_ready", task.State)
	}
}

func TestTaskBatchesAssignmentIsAtomicAndScoped(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room", LangEnglish, nil)
	req := TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, BatchID: "A", MemberID: "worker", Name: "Worker", Title: "Work"}
	bad := req
	bad.ParentID = "missing"
	if _, err := p.AssignMember(bad); err == nil || len(p.Tasks("", 10)) != 0 {
		t.Fatal("invalid parent created a card")
	}
	journal := p.dir
	p.dir = filepath.Join(journal, "absent")
	if _, err := p.AssignMember(req); err == nil || len(p.Tasks("", 10)) != 0 {
		t.Fatal("failed save published an assignment")
	}
	p.dir = journal
	var grants []*TaskMemberGrant
	var mu sync.Mutex
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			grant, err := p.AssignMember(req)
			if err != nil {
				t.Error(err)
				return
			}
			mu.Lock()
			grants = append(grants, grant)
			mu.Unlock()
		}()
	}
	wg.Wait()
	if len(grants) != 8 || len(p.Tasks("", 10)) != 1 {
		t.Fatal("concurrent retry lost or duplicated card")
	}
	for _, grant := range grants {
		if *grant != *grants[0] {
			t.Fatal("concurrent retry changed grant")
		}
	}
	id := grants[0].TaskID
	bad = req
	bad.BatchID, bad.TaskID = "", id
	if grant, err := p.AssignMember(bad); err != nil || *grant != *grants[0] {
		t.Fatal("retry by returned task id was not idempotent", err)
	}
	bad.SessionKey = "other"
	if _, err := p.AssignMember(bad); err == nil {
		t.Fatal("cross-session assignment accepted")
	}
	other := p.begin(platform, "room", LangEnglish, nil)
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: other, TaskID: id, Seq: 1, Kind: "update", Summary: "forged"}); err == nil {
		t.Fatal("unowned task report accepted")
	}
	bad.Run, bad.SessionKey = other, "room"
	if _, err := p.AssignMember(bad); err == nil {
		t.Fatal("stole another live turn's card")
	}
	member := progressToken(t, grants[0].ReportCommand)
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: member, TaskID: "other", Seq: 1, Kind: "result", Summary: "forged"}); err == nil {
		t.Fatal("member selected another card")
	}
	p.finish(run, "cancelled")
	if task, _ := p.Task(id); task.State != TaskStateCancelled || task.Members[0].Live() {
		t.Fatal("cancelled turn left delegated work live")
	}
	if _, err := p.AssignMember(req); err == nil {
		t.Fatal("expired run opened another card")
	}
}

func TestTaskBatchesNewWorkDoesNotContinueReportedCard(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run, oldID := startCard(t, p, platform, "room", "Original work")
	p.finish(run, "result")
	next := p.begin(platform, "room", LangEnglish, nil)
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: next, Seq: 2, Kind: "update", Summary: "follow-up"}); err != nil {
		t.Fatal(err)
	}
	before, _ := p.Task(oldID)
	grant, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: next, BatchID: "new-work", MemberID: "worker", Name: "Worker", Title: "New work"})
	if err != nil || grant.TaskID == oldID {
		t.Fatalf("new delegation continued old progress: %v", err)
	}
	if old, _ := p.Task(oldID); old.Title != before.Title || old.Seq != before.Seq || len(old.Members) != 0 {
		t.Fatal("batch assignment modified the previously reported card")
	}
	if len(p.Tasks("room", 10)) != 2 {
		t.Fatal("new batch did not have its own durable card")
	}
}

func TestTaskBatchesTerminalReportsIsolateCard(t *testing.T) {
	for _, kind := range []string{"failed", "cancelled"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			platform := newProgressPlatform()
			p, err := NewPublicProgress(dir, "fish", []Platform{platform})
			if err != nil {
				t.Fatal(err)
			}
			run := p.begin(platform, "room", LangEnglish, nil)
			assign := func(batch string) *TaskMemberGrant {
				t.Helper()
				g, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, BatchID: batch, MemberID: "worker", Name: "Worker", Title: batch})
				if err != nil {
					t.Fatal(err)
				}
				return g
			}
			first, second := assign("A"), assign("B")
			req := PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, TaskID: first.TaskID, Seq: 1, Kind: kind, Summary: kind}
			for range 2 {
				if _, err := p.Report(req); err != nil {
					t.Fatal("terminal report or exact retry failed:", err)
				}
			}
			req.Seq, req.Kind = 2, "update"
			if _, err := p.Report(req); err == nil {
				t.Fatal("terminal card resumed without a new task")
			}
			req.Run, req.TaskID, req.Seq = progressToken(t, second.ReportCommand), "", 1
			if _, err := p.Report(req); err != nil {
				t.Fatal("ending A revoked B's member:", err)
			}
			p.finish(run, "result")
			p.Flush(context.Background())
			if links := p.taskLinks(); len(links) != 1 || links[0].ID != second.TaskID {
				t.Fatal("ending A removed B or retained A", links)
			}
			restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
			if err != nil {
				t.Fatal(err)
			}
			if task, ok := restored.Task(first.TaskID); !ok || string(task.State) != kind || task.Members[0].Live() {
				t.Fatal("terminal state or history changed across turn end/restart")
			}
		})
	}
}

func TestTaskMembersIndependentReportsOneCard(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room", LangChinese, nil)
	id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "总进度"})
	if err != nil {
		t.Fatal(err)
	}
	assignment := TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, TaskID: id, MemberID: "worker", Name: "肥鱼", Title: "回归测试"}
	g, err := p.AssignMember(assignment)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := p.AssignMember(assignment)
	if err != nil || *retry != *g {
		t.Fatalf("assignment retry = %+v, %v", retry, err)
	}
	changed := assignment
	changed.Title = "other work"
	if _, err := p.AssignMember(changed); err == nil {
		t.Fatal("reused member id accepted")
	}
	child := assignment
	child.MemberID = "child"
	child.ParentID = "worker"
	child.Name = "子agent A"
	cg, err := p.AssignMember(child)
	if err != nil {
		t.Fatal(err)
	}
	workerToken, childToken := progressToken(t, g.ReportCommand), progressToken(t, cg.ReportCommand)
	p.Flush(context.Background())
	if got := platform.task(id); got.Members[0].Status != "queued" || !got.Members[0].StartedAt.IsZero() {
		t.Fatalf("assignment fabricated execution: %+v", got.Members)
	}
	report := func(token string, seq int64, kind string) PublicProgressRequest {
		return PublicProgressRequest{Project: "fish", SessionKey: "room", Run: token, Seq: seq, Kind: kind, Summary: kind}
	}
	var wg sync.WaitGroup
	for _, token := range []string{workerToken, childToken} {
		wg.Add(1)
		go func(token string) {
			defer wg.Done()
			if _, err := p.Report(report(token, 1, "update")); err != nil {
				t.Error(err)
			}
		}(token)
	}
	wg.Wait()
	p.Flush(context.Background())
	got := platform.task(id)
	if len(platform.snapshots) != 1 || len(got.Members) != 2 || got.LatestProgress != "总进度" || got.State != TaskStateInProgress {
		t.Fatalf("not a single independent card: %+v", got)
	}
	for _, m := range got.Members {
		if m.StartedAt.IsZero() || m.UpdatedAt.IsZero() || !m.EndedAt.IsZero() {
			t.Fatalf("wrong member clock: %+v", m)
		}
	}
	wrongSession := report(workerToken, 2, "result")
	wrongSession.SessionKey = "other"
	if _, err := p.Report(wrongSession); err == nil {
		t.Fatal("cross-session report accepted")
	}
	changed.Run = workerToken
	changed.MemberID = "forged"
	if _, err := p.AssignMember(changed); err == nil {
		t.Fatal("member gained lead privileges")
	}
	if _, err := p.Report(report(workerToken, 2, "waiting")); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Report(report(run, 2, "result")); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	p.Flush(context.Background())
	if _, err := p.Report(report(workerToken, 3, "result")); err != nil {
		t.Fatal("member could not finish after lead turn", err)
	}
	p.Flush(context.Background())
	ended := platform.task(id).Members[0].EndedAt
	if _, err := p.Report(report(workerToken, 3, "result")); err != nil {
		t.Fatal("terminal retry failed", err)
	}
	if _, err := p.Report(report(childToken, 2, "result")); err != nil {
		t.Fatal(err)
	}
	p.Flush(context.Background())
	if !platform.task(id).Members[0].EndedAt.Equal(ended) {
		t.Fatal("retry changed duration")
	}
	if _, err := p.Accept(id, "human"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Report(report(childToken, 3, "update")); err == nil {
		t.Fatal("report after acceptance allowed")
	}
	data, err := os.ReadFile(filepath.Join(p.dir, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), workerToken) || strings.Contains(string(data), childToken) {
		t.Fatal("member capability persisted")
	}
}

func TestTaskMembersRestartAndCancellation(t *testing.T) {
	for _, outcome := range []string{"restart", "cancelled"} {
		t.Run(outcome, func(t *testing.T) {
			dir := t.TempDir()
			platform := newProgressPlatform()
			p, err := NewPublicProgress(dir, "fish", []Platform{platform})
			if err != nil {
				t.Fatal(err)
			}
			run := p.begin(platform, "room", LangEnglish, nil)
			id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "start"})
			if err != nil {
				t.Fatal(err)
			}
			g, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, TaskID: id, MemberID: "worker", Name: "Worker", Title: "Test"})
			if err != nil {
				t.Fatal(err)
			}
			req := PublicProgressRequest{Project: "fish", SessionKey: "room", Run: progressToken(t, g.ReportCommand), Seq: 1, Kind: "update", Summary: "working"}
			if _, err := p.Report(req); err != nil {
				t.Fatal(err)
			}
			if outcome == "restart" {
				if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 2, Kind: "result", Summary: "handoff"}); err != nil {
					t.Fatal(err)
				}
				p.finish(run, "result")
				p, err = NewPublicProgress(dir, "fish", []Platform{platform})
				if err != nil {
					t.Fatal(err)
				}
			} else {
				p.finish(run, outcome)
			}
			p.Flush(context.Background())
			if platform.task(id).Members[0].Live() {
				t.Fatal("stale member remains live")
			}
			req.Seq = 2
			req.Kind = "result"
			if _, err := p.Report(req); err == nil {
				t.Fatal("revoked capability accepted")
			}
		})
	}
}

// Regression for #89 review: the lead's turn ending normally and its session
// later being marked stopped (idle timeout, recycle, /stop) must not orphan
// members, and a member that never reports an end must not block acceptance.
func TestTaskMembersSurviveStoppedLead(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	var stopped atomic.Bool
	run := p.begin(platform, "room", LangChinese, stopped.Load)
	id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "s"})
	if err != nil {
		t.Fatal(err)
	}
	assign := func(member string) string {
		g, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, TaskID: id, MemberID: member, Name: member, Title: "t"})
		if err != nil {
			t.Fatal(err)
		}
		return progressToken(t, g.ReportCommand)
	}
	done, silent := assign("done"), assign("silent")
	for _, tok := range []string{done, silent} {
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: tok, Seq: 1, Kind: "update", Summary: "go"}); err != nil {
			t.Fatal(err)
		}
	}
	p.finish(run, "result")
	stopped.Store(true)
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: done, Seq: 2, Kind: "result", Summary: "ok"}); err != nil {
		t.Fatal("member report rejected after lead stopped:", err)
	}
	if _, err := p.Accept(id, "human"); err != nil {
		t.Fatal("card with a silent member could not be accepted:", err)
	}
	p.Flush(context.Background())
	members := platform.task(id).Members
	if members[0].Status != "completed" || members[1].Status != "interrupted" || members[1].EndedAt.IsZero() {
		t.Fatalf("member states = %s/%s, want completed/interrupted", members[0].Status, members[1].Status)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: silent, Seq: 2, Kind: "update", Summary: "late"}); err == nil {
		t.Fatal("interrupted member grant still accepted reports")
	}
}
