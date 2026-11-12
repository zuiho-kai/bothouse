package core

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// #1492 常识：没验收的活不算完成。With automatic review off, the scan closed every handed-back item
// at once, though the lead still had the report held and then sent it back: live #1492 was 「已完成」
// at 11:21:49 and the lead's 「打回」 came at 11:22:18; #1489 (PR still a draft) closed at 10:28 after
// a 10:26 打回.
func TestReviewOffDoesNotCloseARejectedHandback(t *testing.T) {
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
	if !e.isTeamLead() {
		t.Skip("fixture engine is not the team lead")
	}
	returned := time.Now().Add(-time.Minute)
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 5, What: "rejected by the lead", Chat: "room:chat", Dispatcher: "lead", ReturnedAt: returned},
		teamTaskBoardItem{ID: 6, What: "no verdict", Chat: "room:chat", Dispatcher: "lead", ReturnedAt: returned},
	)
	recordTaskVerdict(e.dataDir, 5, "reject", "打回：补线上证据", time.Now())
	newHandoffWatch(e).reconcileTaskReviews(time.Now(), false)
	items := readTeamTaskBoard(e.team.dir)
	if len(items) != 1 || items[0].ID != 5 {
		t.Fatalf("board after the scan = %+v, want only #5 left (the lead sent it back), #6 closed", items)
	}
}
