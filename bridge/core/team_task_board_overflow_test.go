package core

import (
	"fmt"
	"strings"
	"testing"
)

// A running summary is one line containing several tasks. If even that line
// cannot fit, the overflow note must count its tasks, not just individual rows.
func TestCompactBoardOverflowCountsRunningAndWorkspaceRows(t *testing.T) {
	for _, tc := range []struct {
		text    string
		omitted int
	}{
		{"**任务板**\n**在做 3**  ▶ 第一件  ▶ 第二件  ▶ 第三件", 3},
		{"**这里在做**\n⚠ 第一件 · 卡住 · 一小时无人接\n▶ 第二件 · 在做 · 刚刚\n⏸ 第三件 · 等你 · 确认", 3},
	} {
		got := cutTeamBoardLines(tc.text, 23, "")
		if len([]rune(got)) > 23 || !strings.HasSuffix(got, fmt.Sprintf("…还有 %d 件放不下", tc.omitted)) {
			t.Fatalf("overflow = %q", got)
		}
	}
}
