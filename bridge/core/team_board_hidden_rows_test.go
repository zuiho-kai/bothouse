package core

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// #1492 常识：放不下要说清放不下几件。Indented pinned-table rows (⚠/⏸/▶/📦) and the workspace board's
// 🟡/📦 rows were not counted, so the cut said 「还有 0 件放不下」 while those tasks vanished.
func TestBoardCutCountsEveryRowKind(t *testing.T) {
	var lines []string
	for i := 0; i < 6; i++ {
		lines = append(lines, fmt.Sprintf("  📦 #%d 等发布的一件活，描述写得比较长一些好占位置", 100+i))
		lines = append(lines, fmt.Sprintf("  ⚠ #%d 卡住的一件活，描述写得比较长一些好占位置", 200+i))
	}
	got := cutTeamBoardLines(strings.Join(lines, "\n"), 80, "")
	if strings.Contains(got, "还有 0 件") || !strings.Contains(got, "还有") {
		t.Fatalf("cut note miscounts the dropped rows: %q", got)
	}
}

// #1492 常识：卡住的要顶上，不能过一天就藏进「搁置」（用户 10-25「卡住顶上」）.
func TestStuckItemIsNotShelvedAfterADay(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 7, What: "没人接的那件活", Status: "已交接", WS: "discord:ws1", Chat: "discord:main", SK: "discord:ws1",
			Bound: now.Add(-30 * time.Hour).Format(time.RFC3339), At: "10-31 06:00"},
	})
	got := renderTeamTaskTable(items, nil, "discord:main", now)
	if !strings.Contains(got, "没人接的那件活") {
		t.Fatalf("a stuck item was folded into 搁置 after a day: %s", got)
	}
}

// #1492 常识：一件活一行。A task waiting on the user (ws-up --ask) with its handoff still open got a
// second, synthetic 「进行中（未登记任务板）」 row; a task the board closed came back as running.
func TestOpenHandoffDoesNotDuplicateOrReviveATask(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.Local)
	p := testTaskBoardPlacer()
	p.openHandoffs = func() map[string]TeamHandoff {
		return map[string]TeamHandoff{
			"feishu:oc_ws":  {Chat: "feishu:oc_a", Board: 7, Title: "选发布范围", At: now.Add(-time.Hour)},
			"feishu:oc_ws2": {Chat: "feishu:oc_a", Board: 8, Title: "已经收口的活", At: now.Add(-time.Hour)},
		}
	}
	p.boardDoneIDs = func() map[int]bool { return map[int]bool{8: true} }
	items := placeTeamTaskBoard(p, []teamTaskBoardItem{
		{ID: 7, What: "选发布范围", Status: "等待用户答复", Paused: "11-01 11:00", PauseWhy: "等待用户答复：范围", Chat: "feishu:oc_a", SK: "feishu:oc_a", At: "11-01 11:00"},
	})
	n7, n8 := 0, 0
	for _, it := range items {
		switch it.ID {
		case 7:
			n7++
		case 8:
			n8++
		}
	}
	if n7 != 1 || n8 != 0 {
		t.Fatalf("rows: #7=%d (want 1), #8=%d (want 0): %+v", n7, n8, items)
	}
}

// #1492 N6: since #699 D the status column is text, not state; an item whose status starts with
// 「完成」 is still live work in its workspace, so its open handoff gets no second synthetic row.
func TestStatusTextDoesNotEndAWorkspaceItem(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.Local)
	p := testTaskBoardPlacer()
	p.openHandoffs = func() map[string]TeamHandoff {
		return map[string]TeamHandoff{"feishu:oc_ws": {Chat: "feishu:oc_a", Title: "改接口", At: now.Add(-time.Hour)}}
	}
	items := placeTeamTaskBoard(p, []teamTaskBoardItem{
		{ID: 9, What: "改接口", Status: "完成第一步，接着测", WS: "feishu:oc_ws", SK: "feishu:oc_ws", Chat: "feishu:oc_a", At: "11-01 11:00"},
	})
	if len(items) != 1 {
		t.Fatalf("a 「完成…」 status counted as ended: %d rows %+v", len(items), items)
	}
}
