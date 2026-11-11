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
	good := "[report] #7 背景：反思里两条待办，用户要逐条做完\n长测试跑法写进流程页，交回加了自查\n要你做的：没有\n我加的：无\n细节：\n- 长测试后台跑：已写\n- 交回骨架和核对脚本：已做\n入口自验：在流程页上跑了一遍\n```\n$ make check\nok\n```\n"
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

func TestEntryReportProblems(t *testing.T) {
	have := func(p string) bool { return p == "/Users/x/shot.png" || p == "~/out/final.mp4" }
	head := "[report] #7 背景：b\n做了\n要你做的：没有\n我加的：无\n细节：\n"
	for _, c := range []struct {
		name, body string
		ok         bool
		hint       string
	}{
		{"none", head, false, "入口自验"},
		{"bare words", head + "入口自验：已验，没问题\n", false, "入口自验"},
		{"screenshot same line", head + "入口自验：在 Discord 频道发了一条，截图 /Users/x/shot.png\n", true, ""},
		{"product next line", head + "入口自验：成品本身\n- ~/out/final.mp4\n", true, ""},
		{"link", head + "入口自验：https://example.com/pr/1\n", true, ""},
		{"command output", head + "入口自验：装好的发布包里跑\n```\n$ bothouse --version\nv1\n```\n", true, ""},
		{"missing file", head + "入口自验：截图 /Users/x/nope.png\n", false, "/Users/x/nope.png"},
		{"after blank line not evidence", head + "入口自验：看过\n\n/Users/x/shot.png\n", false, "入口自验"},
		{"waiting outside", head + "等外部：没空卡\n再看：2h\n", true, ""},
	} {
		p := entryReportProblems(c.body, have)
		if c.ok != (p == nil) || (!c.ok && !strings.Contains(strings.Join(p, ""), c.hint)) {
			t.Errorf("%s: %v", c.name, p)
		}
	}
	if !strings.Contains(ReportSkeleton(7, preflightNotes), "入口自验："+ReportBlank) {
		t.Error("skeleton lacks the 入口自验 blank")
	}
}
