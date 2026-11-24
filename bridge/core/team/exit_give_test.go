package team

import (
	"strings"
	"testing"
)

// #1982 (user 11-25 「为什么没给我网页？」「加一个栏目就是返回给用户的东西没有可以填无」): the part for the
// user carries a 「给你的：」 line; the link written only in the details does not reach the user.
func TestReportGiveLine(t *testing.T) {
	const head = "[report] #7 背景：你让我照那份思路改首页。\n新网页已上线。\n要你做的：打开网页看一眼。\n"
	cases := []struct {
		name, body string
		bad        bool
		inSummary  string
	}{
		{"link only in the details (#1981)", head + "我加的：无\n细节：\n入口自验：https://x.pages.dev/a\n", true, ""},
		{"link in the give line", head + "给你的：https://x.pages.dev/a\n我加的：无\n细节：\n入口自验：看过\n", false, "https://x.pages.dev/a"},
		{"give line after 我加的", head + "我加的：无\n给你的：~/work/readme.html\n细节：\n入口自验：看过\n", false, "~/work/readme.html"},
		{"nothing to give", head + "给你的：无\n我加的：无\n细节：\n入口自验：看过\n", false, "给你的：无"},
		{"give line with words only", head + "给你的：新网页\n我加的：无\n细节：\n入口自验：看过\n", true, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, body, ok := ParseExitKind(c.body)
			if !ok {
				t.Fatal("not a marked reply")
			}
			v := JudgeExit(ExitKindReport, body, false, func(int) bool { return true }, 0)
			give := false
			for _, p := range v.Problems {
				give = give || strings.Contains(p, "给你的")
			}
			if give != c.bad {
				t.Fatalf("give problem = %v, want %v: %q", give, c.bad, v.Problems)
			}
			if !c.bad && len(v.Problems) > 0 {
				t.Fatalf("a path or link in 「给你的」 must not trip the plain-language checks: %q", v.Problems)
			}
			if sum, _ := ExitSplit(body); c.inSummary != "" && !strings.Contains(sum, c.inSummary) {
				t.Fatalf("「给你的」 must be in the part posted to the user, got %q", sum)
			}
		})
	}
	if !strings.Contains(ReportSkeleton(7, ""), "给你的："+ReportBlank) {
		t.Fatal("the report skeleton must have a 「给你的：」 blank")
	}
}
