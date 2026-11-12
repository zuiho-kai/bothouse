package core

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// #1492 常识「做了才记做过」: with verification off, a handback closes as done only once its report
// reached the chat channel. #1489 was closed 「已完成」 two minutes after the lead sent its held
// report back for rework (PR #1664 still a draft waiting for CI): returned_at alone is not done.
func TestReviewOffClosesOnlyAPostedHandback(t *testing.T) {
	SetTeamReviewDisabled(true)
	t.Cleanup(func() { SetTeamReviewDisabled(false) })
	e := NewEngine("lead", &stubAgent{}, reviewTestPlatforms(), "", LangChinese)
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
	bound := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	returned := time.Now().Add(-time.Minute)
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 1, What: "sent back by the lead", Chat: "room:chat", Dispatcher: "lead", Bound: bound, ReturnedAt: returned},
		teamTaskBoardItem{ID: 2, What: "posted", Chat: "room:chat", Dispatcher: "lead", Bound: bound, ReturnedAt: returned},
	)
	e.markExitReported(2)
	newHandoffWatch(e).reconcileTaskReviews(time.Now(), false)
	open := map[int]bool{}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		open[it.ID] = true
	}
	if !open[1] {
		t.Fatal("a handback whose report never reached the chat channel was closed as done")
	}
	if open[2] {
		t.Fatal("a posted handback was not closed with verification off")
	}
}
