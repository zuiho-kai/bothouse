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
