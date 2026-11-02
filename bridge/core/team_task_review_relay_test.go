package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Exercise the real dispatch journal, production EnablePublicProgress wiring,
// watcher and board CLI. Only the platform and worker process are substitutes.
func completedRelayBoardReview(t *testing.T) (*Engine, string, *atomic.Int32) {
	t.Helper()
	p, platform, _, _ := taskRelayFixture(t)
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	source := rm.engines["source"]
	t.Cleanup(func() { source.cancel(); rm.engines["target"].cancel() })
	source.SetDataDir(p.dataDir)
	source.SetTeam(t.TempDir(), "Source", false)
	if err := source.ClaimTeamWorkspaceFor("discord:main", "room", "工作区1", "", "review original"); err != nil {
		t.Fatal(err)
	}
	source.productPyBin.Store(t.TempDir())
	gate, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gate, filepath.Join(source.dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	if err := source.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	p = source.publicProgress
	run := p.begin(platform, "discord:room:user", LangChinese, nil)
	id, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:room:user", Run: run, Seq: 1, Kind: "start", Title: "review original", Summary: "started"})
	if err != nil {
		t.Fatal(err)
	}
	item := teamTaskBoardItem{ID: 72, What: "review original", Chat: "discord:main", Dispatcher: "source", Bound: "dispatch-generation", Where: "/notes/original.handoff.prompt"}
	other := item
	other.ID, other.Where = 73, "/notes/other.handoff.prompt"
	writeReviewBoard(t, source, item, other)
	req := taskRelayRequest(id)
	req.Message = "Review the original handoff " + item.Where
	session.events <- Event{Type: EventResult, Content: "[report] #73 response text must not authorize board changes"}
	if _, err := rm.Send(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 1 {
		t.Fatalf("worker executions = %d", starts.Load())
	}
	return source, id, &starts
}

func TestTaskReviewRelayDispatchReturnWatch(t *testing.T) {
	source, _, starts := completedRelayBoardReview(t)
	now := time.Now().UTC()
	watch := newHandoffWatch(source)
	watch.reconcileTaskReviews(now, false)
	got := source.boardItemByID(72)
	if got == nil || got.ReturnedAt.IsZero() || got.Reviewer != "source" || !strings.Contains(got.Status, "待验收") {
		t.Fatalf("completed trusted dispatch never reached board review: %+v", got)
	}
	if other := source.boardItemByID(73); other == nil || !other.ReturnedAt.IsZero() {
		t.Fatalf("worker response changed another board item: %+v", other)
	}
	first := got.ReturnedAt
	watch.reconcileTaskReviews(now.Add(time.Minute), false)
	if !source.boardItemByID(72).ReturnedAt.Equal(first) {
		t.Fatal("repeated watch reset the acceptance deadline")
	}
	if err := source.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	watch.reconcileTaskReviews(now.Add(time.Hour), false)
	if !source.boardItemByID(72).ReturnedAt.Equal(first) || starts.Load() != 1 {
		t.Fatal("restart replayed execution or changed the acceptance deadline")
	}
	if out, err := source.runLeadScript("discord:main", "board", "done", "72", "0"); err != nil {
		t.Fatalf("accept: %s %v", out, err)
	}
	watch.reconcileTaskReviews(now.Add(2*time.Hour), false)
	for _, it := range readTeamTaskBoard(source.team.dir) {
		if it.ID == 72 {
			t.Fatal("replayed return reopened accepted work")
		}
	}
}

func TestTaskReviewRelayWatchKeepsDispatchBoundary(t *testing.T) {
	for _, scenario := range []string{"restart-before-consume", "watch-on-another-role", "old-bound", "old-revision", "paused", "rejected"} {
		t.Run(scenario, func(t *testing.T) {
			source, id, starts := completedRelayBoardReview(t)
			watch := newHandoffWatch(source)
			now := time.Now().UTC()
			switch scenario {
			case "restart-before-consume":
				if err := source.EnablePublicProgress(); err != nil {
					t.Fatal(err)
				}
			case "watch-on-another-role":
				peer := source.relayManager.engines["target"]
				peer.SetTeam(source.team.dir, "Target", false)
				watch = newHandoffWatch(peer)
				// APIServer.startHandoffWatch supplies all engines in production.
				watch.engines = source.watchEngines
			case "old-bound":
				// Model a different dispatch replacing the board generation while
				// the original worker was running. The old receipt stays untouched.
				current := *source.boardItemByID(72)
				current.Bound = "next-generation"
				writeReviewBoard(t, source, current, *source.boardItemByID(73))
			case "old-revision":
				if _, err := source.publicProgress.Rework(TaskReworkRequest{Project: "source", TaskID: id, RequestID: "new-requirement", Feedback: "the original evidence is insufficient"}); err != nil {
					t.Fatal(err)
				}
			case "paused":
				if out, err := source.runLeadScript("discord:main", "board", "pause", "72", "user paused this work"); err != nil {
					t.Fatalf("pause: %s %v", out, err)
				}
			case "rejected":
				watch.reconcileTaskReviews(now, false)
				if out, err := source.runLeadScript("discord:main", "board", "reject", "72", "missing evidence"); err != nil {
					t.Fatalf("reject: %s %v", out, err)
				}
				if out, err := source.runLeadScript("discord:main", "board", "resume", "72"); err != nil {
					t.Fatalf("resume: %s %v", out, err)
				}
			}
			watch.reconcileTaskReviews(now.Add(time.Minute), false)
			got := source.boardItemByID(72)
			if scenario == "restart-before-consume" || scenario == "watch-on-another-role" {
				if got == nil || got.ReturnedAt.IsZero() {
					t.Fatal("restart lost the committed return")
				}
			} else if got == nil || !got.ReturnedAt.IsZero() {
				t.Fatalf("stale return changed the current board: %+v", got)
			}
			if scenario == "paused" && got.Paused == "" {
				t.Fatal("late receipt resumed paused work")
			}
			if starts.Load() != 1 {
				t.Fatal("watch replayed the worker")
			}
		})
	}
}
