package core

import (
	"strings"
	"testing"
)

func TestGenericReportProblems(t *testing.T) {
	bad := []string{
		"#1 背景：x\n做了 y\n要你做的：没有\n我加的：只给 Claude Code 装了这个 hook",
		"#1 背景：x\n做了 y\n要你做的：没有\n我加的：仅cc 支持",
		"#1 背景：x\n做了 y\n要你做的：没有\n我加的：只做了 CC 的版本",
	}
	for _, b := range bad {
		if got := genericReportProblems(b); len(got) != 1 || !strings.Contains(got[0], "所有 CLI") {
			t.Errorf("want bounce for %q, got %v", b, got)
		} else {
			t.Logf("bounce: %s", exitBounceText(exitKindReport, got))
		}
	}
	ok := []string{
		"#1 背景：x\n做了 y\n要你做的：没有\n我加的：无",
		"#1 背景：x\n做了 y\n要你做的：没有\n我加的：所有 CLI 都装了（Claude Code、Codex、Gemini）",
		"#1 背景：x\n做了 y\n要你做的：没有\n我加的：只给 Claude Code，来源：Codex 没有 PreToolUse 接口",
		"#1 背景：x\n只给 Claude Code 做了\n要你做的：没有\n我加的：无",
		"#1 背景：x\n做了 y\n要你做的：没有\n我加的：只抄送 accept 列表",
	}
	for _, b := range ok {
		if got := genericReportProblems(b); got != nil {
			t.Errorf("want pass for %q, got %v", b, got)
		}
	}
}
