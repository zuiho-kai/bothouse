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
