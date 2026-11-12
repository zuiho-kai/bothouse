package core

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #1492 用户 11-12「带基本常识梳理一下，现在vibe code，太多这种傻逼东西了，和我想的不一样」：
// 任务板上违反常识的显示逻辑，一条一个用例。

// goneGuild: a Discord guild that also answers whether one channel is deleted.
type goneGuild struct {
	*fakeWorkspaceGuild
	deleted map[string]bool
	asked   []string
}

func (g *goneGuild) TeamChannelGone(_ context.Context, id string) (bool, error) {
	g.asked = append(g.asked, id)
	return g.deleted[id], nil
}

// N1: the channel list holds only the guild's text channels; a thread / forum post / DM chat
// channel (11-10) is not in it, and its items must not vanish from the pinned table silently.
// Only a channel the platform confirms deleted is hidden.
func TestCS1492BoardKeepsThreadAndDMChatItems(t *testing.T) {
	g := &goneGuild{fakeWorkspaceGuild: newWorkspaceGuild(), deleted: map[string]bool{"777": true}}
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangChinese)
	t.Cleanup(e.cancel)
	dataDir := t.TempDir()
	e.SetDataDir(dataDir)
	if err := writeJSONFile(filepath.Join(dataDir, setupStateFile), SetupState{Platform: "discord", ChannelID: "100"}, 0o644); err != nil {
		t.Fatal(err)
	}
	teamTaskBoardChannels.Lock()
	teamTaskBoardChannels.at = nil // a fresh list for this test
	teamTaskBoardChannels.Unlock()
	t.Cleanup(func() { // the list is process-wide: leave none behind for other tests
		teamTaskBoardChannels.Lock()
		teamTaskBoardChannels.at, teamTaskBoardChannels.ids = nil, nil
		teamTaskBoardChannels.Unlock()
	})
	items := []teamTaskBoardItem{
		{ID: 1, What: "主频道的活", own: "discord:100"},
		{ID: 2, What: "子区里派的活", own: "discord:thread55"},
		{ID: 3, What: "私聊派的活", own: "discord:dm66"},
		{ID: 4, What: "已删频道的活", own: "discord:777"},
	}
	var ids []int
	for _, it := range e.dropGoneTeamTaskBoard(items) {
		ids = append(ids, it.ID)
	}
	if got := fmt.Sprint(ids); got != "[1 2 3]" {
		t.Fatalf("kept items %v, want [1 2 3] (thread and DM kept, only the deleted 777 hidden)", ids)
	}
}

// N2: a stuck handoff (bound to a workspace, no progress) over a day old stays on the table as
// 卡住; 「超一天没动自动进搁置」 is for items nobody works on (user 10-25: 卡住要顶上，不能自动暂停藏起来).
func TestCS1492StuckOverADayIsNotShelved(t *testing.T) {
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "修登录", Short: "修登录", Status: "进行中", WS: "feishu:oc_ws", Chat: "feishu:oc_a",
			Bound: now.Add(-30 * time.Hour).Format(time.RFC3339), At: "11-11 06:00"},
	})
	if st, _ := teamTaskBoardStateOf(items[0], now); st != teamTaskStuck {
		t.Fatalf("state = %v, want stuck", st)
	}
	got := renderTeamTaskTable(items, nil, "feishu:oc_a", now)
	if !strings.Contains(got, "修登录") || !strings.Contains(got, "卡住") || strings.Contains(got, "搁置") {
		t.Fatalf("a stuck item was shelved out of sight:\n%s", got)
	}
}

// N3: board.py writes board.jsonl before it parks/closes the handoff, and the bridge re-reads the
// file within a second. A handoff whose board item the board already knows (paused, or done in
// board-done.jsonl) must not show it back as 在做 or as a 「进行中（未登记任务板）」 row.
func TestCS1492OpenHandoffDoesNotOverrideBoard(t *testing.T) {
	now := time.Now()
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	boardDir := t.TempDir()
	e.SetTeam(boardDir, "橘", true)
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardDoneFile), []byte(
		`{"id":8,"what":"已做完的活","status":"完成","done_at":"11-12 11:00"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	bound := now.Add(-time.Hour)
	p := e.teamTaskBoardPlacer()
	p.handoffOf, p.handoffEnded, p.idleWorkspaces = nil, nil, nil
	p.openHandoffs = func() map[string]TeamHandoff {
		return map[string]TeamHandoff{
			"discord:ws1": {Board: 7, Chat: "discord:main", Title: "叫停的活", At: bound},
			"discord:ws2": {Board: 8, Chat: "discord:main", Title: "已做完的活", At: bound},
		}
	}
	got := placeTeamTaskBoard(p, []teamTaskBoardItem{
		{ID: 7, What: "叫停的活", Paused: "11-12 11:59", PauseWhy: "用户叫停", WSWas: "discord:ws1", Chat: "discord:main",
			Bound: bound.UTC().Format(time.RFC3339Nano)},
	})
	for _, it := range got {
		if it.ID == 7 && it.Paused == "" {
			t.Errorf("paused #7 shown back as in work: %+v", it)
		}
		if it.ID == 8 || strings.Contains(it.Status, "未登记任务板") {
			t.Errorf("done #8 synthesized as a running row: %+v", it)
		}
	}
	if len(got) != 1 {
		t.Errorf("items = %+v, want only the paused #7", got)
	}
}

// N4: 「等了 X」 on a row waiting for the user counts from the question (paused), not from the
// handoff (bound).
func TestCS1492WaitingRowCountsFromTheQuestion(t *testing.T) {
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.Local)
	asked := now.Add(-time.Hour)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "选发布范围", Short: "选发布范围", Status: "等待用户答复", WSWas: "feishu:oc_ws", Chat: "feishu:oc_a", SK: "feishu:oc_a",
			Bound:  now.Add(-5 * time.Hour).UTC().Format(time.RFC3339Nano),
			Paused: asked.Format("01-02 15:04"), PausedAt: asked.UTC().Format(time.RFC3339Nano), PauseWhy: "等待用户答复：发布范围"},
	})
	got := renderTeamTaskTable(items, nil, "feishu:oc_a", now)
	if !strings.Contains(got, "选发布范围 · 等了 1小时") {
		t.Fatalf("waiting row should count from the question 1h ago:\n%s", got)
	}
}

// N5: 卡住 is judged by the workspace's own reports and the handoff time; a lead's board edit (At)
// is not progress, and 「交出 N 小时没人接」 counts from the handoff.
func TestCS1492LeadEditDoesNotUnstick(t *testing.T) {
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "修登录", Short: "修登录", Status: "进行中（改了措辞）", WS: "feishu:oc_ws", Chat: "feishu:oc_a",
			Bound: now.Add(-3 * time.Hour).UTC().Format(time.RFC3339Nano), At: now.Add(-5 * time.Minute).Format("01-02 15:04")},
	})
	st, note := teamTaskBoardStateOf(items[0], now)
	if st != teamTaskStuck || note != "交出 3 小时没人接" {
		t.Fatalf("state = %v %q, want stuck 「交出 3 小时没人接」", st, note)
	}
	if got := renderTeamTaskTable(items, nil, "feishu:oc_a", now); !strings.Contains(got, "卡住") {
		t.Fatalf("table row not 卡住:\n%s", got)
	}
}
