package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func writeReleaseBoard(t *testing.T, e *Engine, items ...map[string]any) {
	t.Helper()
	var b strings.Builder
	for _, it := range items {
		line, _ := json.Marshal(it)
		b.Write(line)
		b.WriteByte('\n')
	}
	if err := os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardFile), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestReleaseHoldShowsUnderReleaseNotStuck(t *testing.T) {
	now := time.Date(2026, 11, 4, 18, 0, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{{
		ID: 9, What: "QQ 补收翻页", Short: "QQ补收翻页", Status: "进行中", WS: "discord:ws1", Chat: "discord:main",
		Bound: now.Add(-3 * time.Hour).Format(time.RFC3339), At: "11-04 15:00",
		ReleaseHold: &teamReleaseHold{At: now.Add(-time.Hour).UTC().Format(time.RFC3339Nano)},
	}})
	if st, note := teamTaskBoardStateOf(items[0], now); st != teamTaskRelease || note != "为发布暂停" {
		t.Fatalf("held item state %v %q, want 等发布/为发布暂停", st, note)
	}
	for name, got := range map[string]string{
		"board": renderTeamTaskBoard(items, "discord:main", now),
		"table": renderTeamTaskTable(items, nil, "discord:main", now),
	} {
		if strings.Contains(got, "卡住") || !strings.Contains(got, "等发布 1") || !strings.Contains(got, "为发布暂停") {
			t.Errorf("%s: held item must be under 等发布, not 卡住:\n%s", name, got)
		}
	}
	items[0].ReleaseHold = nil
	if st, _ := teamTaskBoardStateOf(items[0], now); st != teamTaskStuck {
		t.Fatalf("control: without the hold the 3h-old item is 卡住, got %v", st)
	}
}

// The claim writes the task sentence as the title (ws-handoff claim --title task[:60]), so the
// real handoff carries no #N: the item is the one bound to its workspace (#984 review 1).
func TestReleaseHoldFailedTurnsDoNotEscalate(t *testing.T) {
	e, p, _, h := watchFixture(t, "", "集中发布：切版本")
	held := map[string]any{"id": 7, "what": "集中发布", "status": "进行中", "who": "工作区1橘", "ws": "discord:ws1", "chat": "discord:chatA",
		"release_hold": map[string]any{"at": time.Now().UTC().Format(time.RFC3339Nano)}}
	writeReleaseBoard(t, e, held)
	for range watchFailLimit + 1 {
		e.watchTurnEnded(p, "discord:ws1", "", false, true, false, time.Time{})
	}
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Fails != 0 || got.Idle.Reported {
		t.Fatalf("failed turns while held must not count: %+v", got.Idle)
	}
	for _, s := range p.sentTo("discord:chatA") {
		if strings.Contains(s, "连续两次报错") {
			t.Fatalf("held item escalated: %q", s)
		}
	}
	// Control: the same failures without the hold do escalate.
	delete(held, "release_hold")
	writeReleaseBoard(t, e, held)
	for range watchFailLimit {
		e.watchTurnEnded(p, "discord:ws1", "", false, true, false, time.Time{})
	}
	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.Fails != watchFailLimit || !got.Idle.Reported {
		t.Fatalf("control: unheld failures must count and report: %+v (handoff %v)", got.Idle, h.At)
	}
}

// An issue or PR number inside the title is not the board item the handoff works on: 「发布 #984
// 收尾」 must not swallow item 984's failures in another workspace (#984 review 1, false match).
func TestReleaseHoldTitleNumberSkipsOtherWorkspaceItem(t *testing.T) {
	e, p, _, h := watchFixture(t, "", "发布 #984 收尾")
	if h.Board != 0 {
		t.Fatalf("a title number must not become the handoff's board: %d", h.Board)
	}
	writeReleaseBoard(t, e, map[string]any{"id": 984, "what": "别的活", "status": "进行中", "ws": "discord:ws9", "chat": "discord:chatB",
		"release_hold": map[string]any{"at": time.Now().UTC().Format(time.RFC3339Nano)}})
	for range watchFailLimit {
		e.watchTurnEnded(p, "discord:ws1", "", false, true, false, time.Time{})
	}
	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.Fails != watchFailLimit || !got.Idle.Reported {
		t.Fatalf("another workspace's held item must not swallow these failures: %+v", got.Idle)
	}
}

// handoffBoardID: the item bound to the workspace, a title number only when it names that item.
func TestHandoffBoardID(t *testing.T) {
	items := []teamTaskBoardItem{
		{ID: 7, What: "集中发布", WS: "discord:ws1", Chat: "discord:chatA"},
		{ID: 984, What: "开着的 PR 收尾", WS: "discord:ws9", Chat: "discord:chatB"},
	}
	for _, c := range []struct {
		name string
		key  string
		h    TeamHandoff
		want int
	}{
		{"bound item, title without a number", "discord:ws1", TeamHandoff{Title: "集中发布：切版本"}, 7},
		{"recorded board wins", "discord:ws1", TeamHandoff{Title: "发布 #984 收尾", Board: 7}, 7},
		{"issue number in the title is not the item", "discord:ws1", TeamHandoff{Title: "发布 #984 收尾"}, 7},
		{"nothing bound here", "discord:ws2", TeamHandoff{Title: "集中发布"}, 0},
	} {
		if got := handoffBoardID(c.key, c.h, items); got != c.want {
			t.Errorf("%s: handoffBoardID = %d, want %d", c.name, got, c.want)
		}
	}
}

// No open handoff yet (another engine has not loaded it, or the workspace was parked): the mark
// is kept for one more pass and reported, never cleared on the first miss (#984 review 2).
// claimers returns the phrase in msg that claims the release mark was already cleared, if any:
// resumeReleaseHoldsPass keeps the mark on the first pass and clears it on the second, so the
// first notice must not say it is gone.
func claimers(msg string) string {
	for _, p := range []string{"已撤掉", "標記已撤掉", "the mark is cleared", "印を解除しました", "se quitó la marca"} {
		if strings.Contains(msg, p) {
			return p
		}
	}
	return ""
}

func TestReleaseHoldKeepsMarkOnePassThenClears(t *testing.T) {
	e, p, _, _ := watchFixture(t, "", "别的活")
	oldDelay, oldEvery, oldUnhold := releaseHoldResumeDelay, releaseHoldRetryEvery, releaseHoldUnhold
	t.Cleanup(func() {
		releaseHoldResumeDelay, releaseHoldRetryEvery, releaseHoldUnhold = oldDelay, oldEvery, oldUnhold
	})
	releaseHoldResumeDelay, releaseHoldRetryEvery = 0, 0
	releaseHoldMisses = map[string]int{}
	var cleared []string
	releaseHoldUnhold = func(_ *Engine, _ string, id int, at string) error {
		cleared = append(cleared, strconv.Itoa(id)+"@"+at)
		return nil
	}
	before := StartTime.Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	writeReleaseBoard(t, e, map[string]any{"id": 42, "what": "没交接的活", "status": "进行中", "ws": "discord:ws7", "chat": "discord:chatA",
		"release_hold": map[string]any{"at": before}})
	if n := e.resumeReleaseHoldsPass(); n != 1 || len(cleared) != 0 {
		t.Fatalf("first pass keeps the mark and asks for a retry: left=%d cleared=%v", n, cleared)
	}
	if sent := p.sentTo("discord:chatA"); len(sent) != 1 || !strings.Contains(sent[0], "42") {
		t.Fatalf("one notice about the item nobody resumes, got %q", sent)
	} else if said := claimers(sent[0]); said != "" {
		// The mark is only cleared on the second pass, so the first notice must not claim it was.
		t.Fatalf("first notice says %q, but the mark is kept for one more pass: %q", said, sent[0])
	}
	if n := e.resumeReleaseHoldsPass(); n != 0 || len(cleared) != 1 || cleared[0] != "42@"+before {
		t.Fatalf("second pass clears the mark with its own time: left=%d cleared=%v", n, cleared)
	}
	if sent := p.sentTo("discord:chatA"); len(sent) != 1 {
		t.Fatalf("the notice is not repeated every pass: %q", sent)
	}
}

func TestReleaseHoldResumesAfterRestart(t *testing.T) {
	e, p, _, _ := watchFixture(t, "", "#7 集中发布")
	_ = p
	oldDelay, oldUnhold := releaseHoldResumeDelay, releaseHoldUnhold
	t.Cleanup(func() { releaseHoldResumeDelay, releaseHoldUnhold = oldDelay, oldUnhold })
	releaseHoldResumeDelay = 0
	var cleared []string
	releaseHoldUnhold = func(_ *Engine, _ string, id int, at string) error {
		cleared = append(cleared, at)
		return nil
	}
	before := StartTime.Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	after := StartTime.Add(time.Hour).UTC().Format(time.RFC3339Nano)
	writeReleaseBoard(t, e,
		map[string]any{"id": 7, "what": "集中发布", "status": "进行中", "ws": "discord:ws1", "chat": "discord:chatA", "release_hold": map[string]any{"at": before}},
		map[string]any{"id": 8, "what": "新打的标记", "status": "进行中", "ws": "discord:ws2", "chat": "discord:chatA", "release_hold": map[string]any{"at": after}},
	)
	// Errors during the release left the watch counting; resuming starts it afresh.
	if _, ok := e.updateIdle(idleAssignment{key: "discord:ws1", h: handoffsOf(e, "discord:ws1")[0]}, func(h *TeamHandoff) {
		h.Idle.Fails, h.Idle.Wakes = 1, 2
	}); !ok {
		t.Fatal("setup")
	}
	e.resumeReleaseHolds()
	if len(cleared) != 1 || cleared[0] != before {
		t.Fatalf("only the mark made before this process is cleared, with its own time: %q", cleared)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.Fails != 0 || got.Idle.Wakes != 0 || got.Idle.Reported {
		t.Fatalf("resumed handoff starts afresh: %+v", got.Idle)
	}
}

// #984 review N1: a held handoff must not be nudged, resumed or parked by the ten-minute watch;
// the mark is what holds it on the board, not the workspace.
func TestReleaseHoldWatchDoesNotNudgeOrPark(t *testing.T) {
	e, p, w, h := watchFixture(t, "", "集中发布：切版本")
	var resumed []string
	w.resume = func(_ Platform, key string, _ TeamHandoff) { resumed = append(resumed, key) }
	writeReleaseBoard(t, e, map[string]any{"id": 7, "what": "集中发布", "status": "进行中", "who": "工作区1橘",
		"ws": "discord:ws1", "chat": "discord:chatA",
		"release_hold": map[string]any{"at": time.Now().UTC().Format(time.RFC3339Nano)}})
	if next := w.tick(h.Due); next.IsZero() || len(p.sentTo("discord:ws1")) != 0 || len(resumed) != 0 {
		t.Fatalf("held item: next=%v nudge=%d resumed=%v", next, len(p.sentTo("discord:ws1")), resumed)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; !got.Parked.IsZero() || got.Nudged {
		t.Fatalf("held item must not be nudged or parked: %+v", got)
	}
	if _, ok := e.WorkspaceParent("discord:ws1"); !ok {
		t.Fatal("held item must keep its workspace")
	}
	// Control: the same handoff without the mark is nudged and parked, so the skip comes from the
	// hold and not from a check that never fires.
	writeReleaseBoard(t, e)
	if got := handoffsOf(e, "discord:ws1")[0]; w.tick(got.Due).IsZero() || !handoffsOf(e, "discord:ws1")[0].Nudged {
		t.Fatalf("control: unheld handoff must be nudged: %+v", handoffsOf(e, "discord:ws1")[0])
	}
}

func TestAwaitDeployShowsUnderReleaseThenOnlineReview(t *testing.T) {
	now := time.Date(2026, 11, 4, 18, 0, 0, 0, time.Local)
	base := teamTaskBoardItem{ID: 12, What: "置顶板精简", Short: "置顶板精简", WS: "discord:ws2", Chat: "discord:main",
		Bound: now.Add(-5 * time.Hour).Format(time.RFC3339), At: "11-04 13:00"}
	merged := base
	merged.Status = "等发布：PR 已合并，等集中发布上线"
	merged.AwaitDeploy = map[string]string{"commit": "abc1234"}
	hand := base
	hand.ID, hand.Short, hand.Status = 13, "打招呼误中断", "随集中发布上线，上线后肥鱼验"
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{merged, hand})
	for _, it := range items {
		if st, _ := teamTaskBoardStateOf(it, now); st != teamTaskRelease {
			t.Fatalf("#%d %q: state %v, want 等发布", it.ID, it.Status, st)
		}
	}
	table := renderTeamTaskTable(items, nil, "discord:main", now)
	if strings.Contains(table, "卡住") || strings.Contains(table, "没人验收") || !strings.Contains(table, "等发布 2") || !strings.Contains(table, "已合并，等上线") {
		t.Fatalf("merged work waiting on the release must be 等发布, not 卡住:\n%s", table)
	}
	deployed := base
	deployed.Status = "待上线验收：已随 fedcba98 部署"
	deployed.Deployed = map[string]string{"commit": "fedcba98"}
	deployed.ReturnedAt = now.Add(-time.Minute)
	deployed.Reviewer = "肥鱼"
	items = placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{deployed})
	if st, note := teamTaskBoardStateOf(items[0], now); st != teamTaskReview || !strings.HasPrefix(note, "待上线验收") {
		t.Fatalf("deployed item: %v %q, want 待验收/待上线验收", st, note)
	}
}

func TestMarkDeployedRunsOnlyForLeadWithWaitingItems(t *testing.T) {
	e, _, _, _ := watchFixture(t, "", "#7 x")
	oldRun, oldCommit := markDeployedRun, CurrentCommit
	t.Cleanup(func() { markDeployedRun, CurrentCommit = oldRun, oldCommit })
	var ran []string
	markDeployedRun = func(_ *Engine, commit string) ([]byte, error) { ran = append(ran, commit); return nil, nil }
	CurrentCommit = "fedcba98"
	writeReleaseBoard(t, e, map[string]any{"id": 7, "what": "x", "status": "进行中"})
	e.markDeployed()
	if len(ran) != 0 {
		t.Fatalf("nothing waits on a release: no board call, got %q", ran)
	}
	writeReleaseBoard(t, e, map[string]any{"id": 7, "what": "x", "status": "等发布", "await_deploy": map[string]any{"commit": "abc1234"}})
	CurrentCommit = "none" // dev build
	e.markDeployed()
	CurrentCommit = "fedcba98"
	e.markDeployed()
	if len(ran) != 1 || ran[0] != "fedcba98" {
		t.Fatalf("one board deployed with the running build's commit, got %q", ran)
	}
}
