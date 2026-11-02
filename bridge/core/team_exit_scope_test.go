package core

import (
	"strings"
	"testing"
)

func TestScopeReportProblemsMissingItem(t *testing.T) {
	notes := "# 拆片\n## 范围\n- 改：看同 UP 另一条（对比节奏）\n改：字幕时间轴，按句切\n- 不改：封面\n## 参照\n- 改：不在范围节里\n"
	body := "#851 背景：拆片\n字幕时间轴已按句切好\n要你做的：没有\n我加的：无\n细节：\n- 改了 subs.go\n"
	got := scopeReportProblems(notes, body)
	if len(got) != 1 || !strings.Contains(got[0], "交接里这几项交回没提到：看同 UP 另一条") ||
		strings.Contains(got[0], "字幕时间轴") || strings.Contains(got[0], "不在范围节里") {
		t.Fatalf("want only 看同 UP 另一条 bounced, got %v", got)
	}
}

func TestScopeReportProblemsAllMentioned(t *testing.T) {
	notes := "# 拆片\n## 范围\n- 改：看同 UP 另一条（对比节奏）\n改：字幕时间轴，按句切\n- 不改：封面\n"
	body := "#851 背景：拆片\n字幕时间轴已按句切好\n要你做的：没有\n我加的：无\n细节：\n- 看同UP另一条：节奏一致，没做额外改动\n"
	if got := scopeReportProblems(notes, body); got != nil {
		t.Fatalf("want pass, got %v", got)
	}
	for _, n := range []string{"", "# 无范围节\n- 改：别的\n", "## 范围\n- 不改：全部\n"} {
		if got := scopeReportProblems(n, "#1 背景：x"); got != nil {
			t.Fatalf("notes %q: want no check, got %v", n, got)
		}
	}
}
