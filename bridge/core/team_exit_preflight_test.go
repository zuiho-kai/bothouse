package core

import (
	"strings"
	"testing"
)

const preflightNotes = "# 交接\n## 范围\n- 改：长测试后台跑，写进流程页\n- 改：交回骨架和核对脚本\n- 不改：常驻规则\n## 进度\n- 改：这里不是范围\n"

func TestReportSkeletonListsScopeAndFailsUntilFilled(t *testing.T) {
	sk := ReportSkeleton(7, preflightNotes)
	if !strings.HasPrefix(sk, "[report] #7 背景：") {
		t.Fatalf("skeleton first line: %q", sk)
	}
	if !strings.Contains(sk, "长测试后台跑") || !strings.Contains(sk, "交回骨架和核对脚本") || strings.Contains(sk, "这里不是范围") || strings.Contains(sk, "常驻规则") {
		t.Fatalf("skeleton scope items wrong:\n%s", sk)
	}
	if p := ReportPreflight(sk, preflightNotes); len(p) == 0 || !strings.Contains(strings.Join(p, "；"), "骨架还有没填的") {
		t.Fatalf("unfilled skeleton passed: %v", p)
	}
}

func TestReportPreflightMatchesBridgeChecks(t *testing.T) {
	good := "[report] #7 背景：反思里两条待办，用户要逐条做完\n长测试跑法写进流程页，交回加了自查\n要你做的：没有\n我加的：无\n细节：\n- 长测试后台跑：已写\n- 交回骨架和核对脚本：已做\n"
	if p := ReportPreflight(good, preflightNotes); p != nil {
		t.Fatalf("good draft bounced: %v", p)
	}
	noMark := strings.TrimPrefix(good, "[report] ")
	if p := ReportPreflight(noMark, preflightNotes); len(p) != 1 || p[0] != exitRules.Headline.MissingMarker {
		t.Fatalf("no marker: %v", p)
	}
	missing := strings.Replace(good, "- 交回骨架和核对脚本：已做\n", "", 1)
	if p := ReportPreflight(missing, preflightNotes); len(p) != 1 || !strings.Contains(p[0], "交回骨架和核对脚本") {
		t.Fatalf("missing scope item: %v", p)
	}
	if p := scopeReportProblems(preflightNotes, missing); len(p) != 1 {
		t.Fatalf("scopeReportProblems after refactor: %v", p)
	}
}
