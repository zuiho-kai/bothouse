package core

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func review194Progress(t *testing.T) (*PublicProgress, *progressTestPlatform, string) {
	t.Helper()
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	return p, platform, dir
}

func TestReview194AcceptedSurvivesTurnFinish(t *testing.T) {
	p, platform, _ := review194Progress(t)
	run, id := startCard(t, p, platform, "room:one", "work")
	_, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "result", Summary: "ready"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Accept(id, "human"); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	task, _ := p.Task(id)
	if task.State != TaskStateCompleted {
		t.Fatalf("accepted task became %s when the same turn finished", task.State)
	}
}

func TestReview194AcceptOldKeepsNewCandidate(t *testing.T) {
	p, platform, _ := review194Progress(t)
	first, oldID := startCard(t, p, platform, "room:one", "old work")
	p.finish(first, "result")
	second, newID := startCard(t, p, platform, "room:one", "new work")
	p.finish(second, "result")
	if _, err := p.Accept(oldID, "human"); err != nil {
		t.Fatal(err)
	}
	next := p.begin(platform, "room:one", LangChinese, nil)
	got, _, ok := p.runStart(next)
	if !ok || got != newID {
		t.Fatalf("accepting old card erased new continuation: got %q/%v want %q", got, ok, newID)
	}
}

func TestReview194RejectedContinuationDoesNotCorruptHistory(t *testing.T) {
	p, platform, dir := review194Progress(t)
	run, id := startCard(t, p, platform, "room:one", "work")
	p.finish(run, "result")
	next := p.begin(platform, "room:one", LangChinese, nil)
	_, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: next, Seq: 10, Kind: "update", Summary: "wrong sequence"})
	if err == nil {
		t.Fatal("invalid sequence accepted")
	}
	p.finish(next, "result")
	p.Flush(context.Background())
	restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	task, _ := restored.Task(id)
	if task.State != TaskStateResultReady {
		t.Fatalf("rejected continuation corrupted historical card on restart: %s", task.State)
	}
}

func TestReview194AcceptanceRetryIsDurableAfterSaveError(t *testing.T) {
	p, platform, dir := review194Progress(t)
	run, id := startCard(t, p, platform, "room:one", "work")
	p.finish(run, "result")
	p.Flush(context.Background())
	journalDir := p.dir
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	p.dir = blocker
	if _, err := p.Accept(id, "human"); err == nil {
		t.Fatal("expected journal failure")
	}
	p.dir = journalDir
	if _, err := p.Accept(id, "human"); err != nil {
		t.Fatal(err)
	}
	p.Flush(context.Background())
	restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	task, _ := restored.Task(id)
	if task.State != TaskStateCompleted {
		t.Fatalf("successful acceptance retry was not durable: %s", task.State)
	}
}

func TestReview194AcceptanceIsTerminalAcrossStopAndRestart(t *testing.T) {
	for _, outcome := range []string{"result", "failed", "cancelled", "restart"} {
		t.Run(outcome, func(t *testing.T) {
			p, platform, dir := review194Progress(t)
			run, id := startCard(t, p, platform, "room:one", "work")
			_, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "waiting", Summary: "confirm"})
			if err != nil {
				t.Fatal(err)
			}
			p.Flush(context.Background())
			if len(p.taskLinks()) != 1 {
				t.Fatal("waiting task not indexed")
			}
			if _, err := p.Accept(id, "human"); err != nil {
				t.Fatal(err)
			}
			if len(p.taskLinks()) != 0 {
				t.Fatal("accepted task remains in index")
			}
			_, err = p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 3, Kind: "update", Summary: "late"})
			if err == nil {
				t.Fatal("accepted task allowed more reports")
			}
			if outcome != "restart" {
				p.finish(run, outcome)
			}
			restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
			if err != nil {
				t.Fatal(err)
			}
			restored.Flush(context.Background())
			card := platform.task(id)
			if card.State != TaskStateCompleted || card.FactStage != FactStageVerified {
				t.Fatalf("lost acceptance: %+v", card)
			}
			last := card.Events[len(card.Events)-1]
			if last.Kind != TaskEventCompleted || last.FactStage != FactStageVerified {
				t.Fatalf("acceptance fact lost: %+v", last)
			}
		})
	}
}

func TestReview194ContinuationFailureLeavesSourceReusable(t *testing.T) {
	for _, failure := range []string{"wrong session", "stopped", "save error"} {
		t.Run(failure, func(t *testing.T) {
			p, platform, _ := review194Progress(t)
			run, id := startCard(t, p, platform, "room:one", "work")
			p.finish(run, "result")
			stopped := failure == "stopped"
			next := p.begin(platform, "room:one", LangChinese, func() bool { return stopped })
			req := PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: next, Seq: 2, Kind: "update", Summary: "continue"}
			journalDir := p.dir
			if failure == "wrong session" {
				req.SessionKey = "room:two"
			}
			if failure == "save error" {
				blocker := filepath.Join(t.TempDir(), "not-a-directory")
				if err := os.WriteFile(blocker, []byte("fixture"), 0600); err != nil {
					t.Fatal(err)
				}
				p.dir = blocker
			}
			if _, err := p.Report(req); err == nil {
				t.Fatal("invalid continuation accepted")
			}
			p.dir, stopped, req.SessionKey = journalDir, false, "room:one"
			card, _ := p.Task(id)
			if card.State != TaskStateResultReady {
				t.Fatal("failed report changed old card")
			}
			if got, err := p.Report(req); err != nil || got != id {
				t.Fatalf("retry lost original card: %s %v", got, err)
			}
			if got, err := p.Report(req); err != nil || got != id {
				t.Fatalf("retry not idempotent: %s %v", got, err)
			}
		})
	}
}

func TestReview194ReportBudgetResetsPerTurn(t *testing.T) {
	p, platform, _ := review194Progress(t)
	run, id := startCard(t, p, platform, "room:one", "work")
	req := PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Kind: "update", Summary: "progress"}
	for req.Seq = 2; req.Seq <= 64; req.Seq++ {
		if _, err := p.Report(req); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.Report(req); err == nil {
		t.Fatal("turn exceeded 64 reports")
	}
	p.finish(run, "result")
	req.Run = p.begin(platform, "room:one", LangChinese, nil)
	if got, seq, ok := p.runStart(req.Run); !ok || got != id || seq != 65 {
		t.Fatalf("wrong continuation: %s/%d/%v", got, seq, ok)
	}
	if got, err := p.Report(req); err != nil || got != id {
		t.Fatalf("card's lifetime sequence incorrectly capped: %s %v", got, err)
	}
}

func TestReview194ExpiredCandidateIsNotOffered(t *testing.T) {
	p, platform, _ := review194Progress(t)
	run, id := startCard(t, p, platform, "room:one", "work")
	p.finish(run, "result")
	p.records[id].record.Task.UpdatedAt = time.Now().Add(-25 * time.Hour)
	next := p.begin(platform, "room:one", LangChinese, nil)
	if _, _, ok := p.runStart(next); ok {
		t.Fatal("expired card offered but cannot be adopted")
	}
}

func TestReview194AcceptConcurrentWithFinish(t *testing.T) {
	for n := 0; n < 20; n++ {
		p, platform, _ := review194Progress(t)
		run, id := startCard(t, p, platform, "room:one", "work")
		_, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 2, Kind: "result", Summary: "ready"})
		if err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); p.finish(run, "result") }()
		go func() { defer wg.Done(); _, err = p.Accept(id, "human") }()
		wg.Wait()
		if err != nil {
			t.Fatal(err)
		}
		card, _ := p.Task(id)
		if card.State != TaskStateCompleted {
			t.Fatalf("accept/finish race: %s", card.State)
		}
	}
}
